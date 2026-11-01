import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import {
  applyCollectedToYaml,
  BRIEF_INPUT_FILE,
  BriefValidationError,
  checkBrandKit,
  checkOpenAiSetup,
  collectBrandKit,
  ContentPlanSchema,
  createAiClient,
  draftBrief,
  mockFixtures,
  parseBriefYaml,
  ReviewSchema,
  RUN_INPUTS_DIR,
  RunStore,
  STAGES,
  type AiCallRecord,
  type Brief,
  type CaptionRecord,
  type Config,
  type Stage,
} from '@recipe/core';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { aiCalls, runs, type Db } from './db.js';
import { copyDir, IMAGE_EXT, KIT_FIELDS, KitStore, listKit, type KitField } from './kits.js';
import type { PendingQuestions, RunEvent, RunEvents } from './events.js';
import { enqueueRun, type JobWorker } from './worker.js';

export interface AppDeps {
  config: Config;
  db: Db;
  events: RunEvents;
  questions: PendingQuestions;
  worker?: JobWorker;
  logger?: boolean;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.zip': 'application/zip',
};

const STAGE_ARTIFACT: Record<Stage, string> = {
  brief: 'brief.json',
  analysis: 'analysis.json',
  plan: 'plan.json',
  create: 'captions.json',
  review: 'review.json',
};

/** Files of the demo run, loaded by "Load the GymBeam example". */
const EXAMPLE_DIR = 'examples/gymbeamhr';

function sendFile(reply: FastifyReply, file: string) {
  reply.header('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  reply.header('content-length', statSync(file).size);
  return reply.send(createReadStream(file));
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db, events, questions } = deps;
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 30 } });

  // Open SSE streams. They are ended on shutdown: otherwise close() waits for them, and a dev
  // proxy keeps the browser side open, so the page would never notice the restart and reconnect.
  const streams = new Set<FastifyReply['raw']>();
  app.addHook('preClose', async () => {
    for (const raw of streams) raw.end();
  });

  const findRun = (id: string) => db.select().from(runs).where(eq(runs.id, id)).get();
  // Input files of runs being prepared (ADR-033); next to the database, outside the repo's tracked files.
  const kits = new KitStore(path.join(path.dirname(config.DATABASE_PATH), 'kits'));
  kits.cleanup(2 * 24 * 60 * 60 * 1000);
  const openStore = (id: string) => RunStore.open(config.RUNS_DIR, id);

  app.get('/api/health', async () => ({ ok: true, provider: config.AI_PROVIDER, openaiKeySet: Boolean(config.OPENAI_API_KEY) }));

  /** Free pre-flight for real runs: is the key accepted and do the configured models exist? */
  app.get('/api/openai/check', async () => checkOpenAiSetup(config));

  app.get('/api/example-brief', async (_req, reply) => {
    reply.type('text/yaml; charset=utf-8');
    return readFileSync(path.join(config.rootDir, 'brief.example.yaml'), 'utf8');
  });

  app.get('/api/example-request', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8');
    // The starting prompt of the demo run (assignment: "specify the starting prompt").
    return readFileSync(path.join(config.rootDir, 'PROMPT.md'), 'utf8');
  });

  // Free-text requests turned into briefs, kept until the run starts so the run records the
  // request and the cost of the AI calls made for it (brief, brand kit). In memory: a restart
  // only loses unstarted drafts.
  const drafts = new Map<string, { text: string; calls: AiCallRecord[] }>();
  const keyMissing = () => config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY;
  const KEY_MISSING = 'OPENAI_API_KEY is not set. Add it to .env and run: docker compose restart server';
  // Without a kit (API calls, tests) the brief is checked against an empty folder.
  const kitDirOf = (kitId: string | undefined) => kits.dir(kitId) ?? path.join(config.RUNS_DIR, '_no_inputs');
  const kitStatus = (brief: Brief | null, kitId: string | undefined) => (brief ? checkBrandKit(kitDirOf(kitId), brief) : null);
  const NO_KIT = 'unknown kitId: reload the Start a run page';

  /** A new, empty set of input files for the Start a run page. */
  app.post('/api/kits', async () => {
    const kitId = kits.create();
    return { kitId, files: listKit(kits.dir(kitId)!) };
  });

  app.get<{ Params: { kitId: string } }>('/api/kits/:kitId', async (req, reply) => {
    const dir = kits.dir(req.params.kitId);
    return dir ? listKit(dir) : reply.code(404).send({ error: NO_KIT });
  });

  /** Upload files: multipart fields `logo`, `products`, `screenshots`. Returns the kit's files. */
  app.post<{ Params: { kitId: string } }>('/api/kits/:kitId/files', async (req, reply) => {
    const dir = kits.dir(req.params.kitId);
    if (!dir) return reply.code(404).send({ error: NO_KIT });
    if (!req.isMultipart()) return reply.code(400).send({ error: 'send the files as multipart/form-data' });
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      if (!KIT_FIELDS.includes(part.fieldname as KitField)) return reply.code(400).send({ error: `unexpected file field "${part.fieldname}"` });
      if (!IMAGE_EXT.test(part.filename)) return reply.code(400).send({ error: `"${part.filename}" is not a PNG/JPEG/WebP image` });
      kits.add(dir, part.fieldname as KitField, part.filename, await part.toBuffer());
    }
    return listKit(dir);
  });

  app.get<{ Params: { kitId: string; '*': string } }>('/api/kits/:kitId/files/*', async (req, reply) => {
    const dir = kits.dir(req.params.kitId);
    const file = dir && kits.file(dir, req.params['*']);
    if (!file) return reply.code(404).send({ error: 'not found' });
    reply.header('cache-control', 'no-store');
    return sendFile(reply, file);
  });

  app.delete<{ Params: { kitId: string; '*': string } }>('/api/kits/:kitId/files/*', async (req, reply) => {
    const dir = kits.dir(req.params.kitId);
    if (!dir || !kits.remove(dir, req.params['*'])) return reply.code(404).send({ error: 'not found' });
    return listKit(dir);
  });

  /** Puts the demo run's files (examples/gymbeamhr) into the kit. */
  app.post<{ Params: { kitId: string } }>('/api/kits/:kitId/example', async (req, reply) => {
    const dir = kits.dir(req.params.kitId);
    if (!dir) return reply.code(404).send({ error: NO_KIT });
    copyDir(path.join(config.rootDir, EXAMPLE_DIR), dir);
    rmSync(path.join(dir, 'README.md'), { force: true });
    return listKit(dir);
  });

  /** Free text → brief for the person to check (one cheap text-model call). */
  app.post('/api/brief/draft', async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; kitId?: string };
    if (!body.text?.trim()) return reply.code(400).send({ error: 'describe the brand and the posts you want' });
    if (keyMissing()) return reply.code(400).send({ error: KEY_MISSING });
    const ai = createAiClient(config, { fixtures: mockFixtures });
    const draft = await draftBrief(ai, { text: body.text, kitDir: kitDirOf(body.kitId) });
    app.log.info({ purpose: draft.call.purpose, model: draft.call.model, costUsd: draft.call.costUsd }, 'brief draft');
    const draftId = draft.call.id;
    drafts.set(draftId, { text: body.text, calls: [draft.call] });
    if (drafts.size > 50) drafts.delete(drafts.keys().next().value!);
    return { ...draft, draftId, kit: kitStatus(draft.brief, body.kitId) };
  });

  /**
   * Collect the logo and product packshots from the brand's website into the kit (ADR-030)
   * and write the found product pages and photo files into the brief.
   */
  app.post('/api/brief/collect', async (req, reply) => {
    const body = (req.body ?? {}) as { yaml?: string; draftId?: string; kitId?: string; replace?: boolean };
    if (!body.yaml?.trim()) return reply.code(400).send({ error: 'brief YAML is required' });
    if (keyMissing()) return reply.code(400).send({ error: KEY_MISSING });
    const kitDir = kits.dir(body.kitId);
    if (!kitDir) return reply.code(400).send({ error: NO_KIT });
    let brief: Brief;
    try {
      brief = parseBriefYaml(body.yaml).brief;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const ai = createAiClient(config, { fixtures: mockFixtures });
    const result = await collectBrandKit(ai, { brief, kitDir, replace: body.replace, log: (m) => app.log.info(m) });
    if (body.draftId) drafts.get(body.draftId)?.calls.push(...result.calls);
    const yaml = applyCollectedToYaml(body.yaml, result.products);
    const parsed = parseBriefYaml(yaml);
    return {
      yaml,
      brief: parsed.brief,
      warnings: parsed.warnings.filter((w) => !w.includes('no valid product page URL')),
      items: result.items,
      kit: kitStatus(parsed.brief, body.kitId),
      files: listKit(kitDir),
      costUsd: result.calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0),
    };
  });

  /**
   * Create a run from `{ briefYaml, draftId?, kitId? }`. The kit's files move into
   * `<run>/inputs/`, so the run keeps exactly the files it was made from (ADR-033).
   */
  app.post('/api/runs', async (req, reply) => {
    const { briefYaml, draftId, kitId } = (req.body ?? {}) as { briefYaml?: string; draftId?: string; kitId?: string };
    if (!briefYaml?.trim()) return reply.code(400).send({ error: 'brief YAML is required (JSON "briefYaml")' });
    // Fail here, not minutes later in stage 2.
    if (keyMissing()) return reply.code(400).send({ error: KEY_MISSING });

    let slug: string;
    try {
      slug = parseBriefYaml(briefYaml).brief.brand.slug;
    } catch (err) {
      const message = err instanceof BriefValidationError || err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }

    const store = RunStore.create(config.RUNS_DIR, slug, config);
    store.writeText('brief', BRIEF_INPUT_FILE, briefYaml);
    const inputsDir = path.join(store.runDir, RUN_INPUTS_DIR);
    const kitDir = kits.dir(kitId);
    if (kitDir) {
      copyDir(kitDir, inputsDir);
      rmSync(kitDir, { recursive: true, force: true });
    } else {
      mkdirSync(inputsDir, { recursive: true });
    }

    db.insert(runs)
      .values({ id: store.runId, brandSlug: slug, status: 'queued', runDir: store.runDir, brandKitDir: inputsDir, provider: config.AI_PROVIDER, createdAt: new Date().toISOString() })
      .run();
    // The request the brief was prepared from, and the cost of preparing it, belong to the run.
    const draft = draftId ? drafts.get(draftId) : undefined;
    if (draft) {
      store.writeText('brief', 'request.txt', draft.text);
      for (const call of draft.calls) {
        store.recordAiCall(call);
        db.insert(aiCalls).values({ ...call, runId: store.runId, error: call.error ?? null }).onConflictDoNothing().run();
      }
      drafts.delete(draftId!);
    }
    enqueueRun(db, store.runId);
    events.publish(store.runId, { type: 'run', status: 'queued' });
    return reply.code(201).send({ runId: store.runId });
  });

  app.get('/api/runs', async () => {
    const open = questions.counts();
    return db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .all()
      .map((r) => ({ ...r, pendingQuestions: open.get(r.id) ?? 0 }));
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    // Input files, when they live in the run folder (all runs since ADR-033), with their URLs.
    const inputsRel = path.relative(run.runDir, run.brandKitDir);
    const inputs = inputsRel && !inputsRel.startsWith('..') && existsSync(run.brandKitDir) ? { base: `/api/runs/${run.id}/files/${inputsRel}`, ...listKit(run.brandKitDir) } : null;
    return { ...run, state: openStore(run.id).getState(), questions: questions.list(run.id), inputs };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event: RunEvent | { type: 'snapshot'; [k: string]: unknown }) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: 'snapshot', status: run.status, error: run.error, state: openStore(run.id).getState(), questions: questions.list(run.id) });
    const unsubscribe = events.subscribe(run.id, send);
    // A named event (not an SSE comment) so the page can tell a silent, dead connection from a quiet run.
    const heartbeat = setInterval(() => reply.raw.write('event: ping\ndata: {}\n\n'), 15_000);
    streams.add(reply.raw);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(reply.raw);
    });
  });

  app.post<{ Params: { id: string }; Body: { fromStep?: number; toStep?: number } }>('/api/runs/:id/rerun', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    if (run.status === 'queued' || run.status === 'running') return reply.code(409).send({ error: `run is ${run.status}` });
    const { fromStep, toStep } = req.body ?? {};
    for (const n of [fromStep, toStep]) {
      if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > STAGES.length)) return reply.code(400).send({ error: `steps must be 1–${STAGES.length}` });
    }
    enqueueRun(db, run.id, { fromStep, toStep });
    events.publish(run.id, { type: 'run', status: 'queued' });
    return reply.code(202).send({ queued: true });
  });

  app.post<{ Params: { id: string }; Body: { questionId: string; answer: string | null } }>('/api/runs/:id/answers', async (req, reply) => {
    const ok = questions.answer(req.params.id, req.body?.questionId, req.body?.answer ?? null);
    return ok ? { ok } : reply.code(404).send({ error: 'no such pending question' });
  });

  app.get<{ Params: { id: string; stage: string } }>('/api/runs/:id/artifacts/:stage', async (req, reply) => {
    const run = findRun(req.params.id);
    const stage = req.params.stage as Stage;
    if (!run || !STAGES.includes(stage)) return reply.code(404).send({ error: 'not found' });
    const store = openStore(run.id);
    if (!store.exists(stage, STAGE_ARTIFACT[stage])) return reply.code(404).send({ error: `stage ${stage} has no output yet` });
    return store.readJson(stage, STAGE_ARTIFACT[stage]);
  });

  /** Posts as the gallery needs them: slides in order (QA-chosen versions once reviewed), copy, goal, scores. */
  app.get<{ Params: { id: string } }>('/api/runs/:id/posts', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const store = openStore(run.id);
    if (!store.exists('plan', 'plan.json') || !store.exists('create', 'captions.json')) return reply.code(404).send({ error: 'posts are not created yet' });
    const plan = store.readJson('plan', 'plan.json', ContentPlanSchema);
    const captions = store.readJson<CaptionRecord[]>('create', 'captions.json');
    const review = store.exists('review', 'review.json') ? store.readJson('review', 'review.json', ReviewSchema) : null;
    const file = (rel: string) => `/api/runs/${run.id}/files/${rel}`;
    return {
      reviewed: Boolean(review),
      passed: review?.passed ?? null,
      needsHumanAttention: review?.needsHumanAttention ?? [],
      posts: plan.posts.map((p) => {
        const caption = captions.find((c) => c.post === p.number);
        const captionReview = review?.captions.find((c) => c.post === p.number) ?? null;
        return {
          number: p.number,
          format: p.format,
          goal: p.goal,
          concept: p.concept,
          rationale: p.rationale,
          caption: p.caption,
          instagramText: caption?.instagramText ?? p.caption,
          captionCheck: captionReview,
          slides: p.slides.map((s) => {
            const qa = review?.slides.find((x) => x.post === p.number && x.slide === s.index) ?? null;
            const chosen = qa ? qa.attempts[qa.chosen]! : null;
            return {
              index: s.index,
              role: s.role,
              headline: s.headline,
              url: file(review ? `05_review/posts/post_${p.number}/slide_${s.index}.png` : `04_create/post_${p.number}/slide_${s.index}.png`),
              qa: chosen ? { score: chosen.score, passed: qa!.passed, attempts: qa!.attempts.length, issues: chosen.issues } : null,
            };
          }),
        };
      }),
    };
  });

  app.get<{ Params: { id: string; '*': string } }>('/api/runs/:id/files/*', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const target = path.resolve(run.runDir, req.params['*']);
    if (!target.startsWith(path.resolve(run.runDir) + path.sep) || !existsSync(target) || !statSync(target).isFile()) {
      return reply.code(404).send({ error: 'file not found' });
    }
    return sendFile(reply, target);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/download', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const store = openStore(run.id);
    if (!store.exists('review', 'posts.zip')) return reply.code(404).send({ error: 'posts.zip is created by the review stage' });
    reply.header('content-disposition', `attachment; filename="${run.id}-posts.zip"`);
    return sendFile(reply, store.path('review', 'posts.zip'));
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/costs', async (req, reply) => {
    const run = findRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    return openStore(run.id).writeCostReport();
  });

  return app;
}
