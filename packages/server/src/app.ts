import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import {
  BRIEF_INPUT_FILE,
  BriefValidationError,
  checkOpenAiSetup,
  ContentPlanSchema,
  createAiClient,
  draftBrief,
  mockFixtures,
  parseBriefYaml,
  ReviewSchema,
  RunStore,
  STAGES,
  type AiCallRecord,
  type CaptionRecord,
  type Config,
  type Stage,
} from '@recipe/core';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { aiCalls, runs, type Db } from './db.js';
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

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** Keeps only the file name and a safe character set (uploads land inside the run folder). */
function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.-]+/g, '_');
}

/**
 * Copies a folder file by file. fs.cpSync fails with EACCES when the target is a Docker Desktop
 * bind mount (runs/ in compose.yaml), while plain copyFileSync works there.
 */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) copyFileSync(src, dest);
  }
}

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
  // request and the cost of that AI call. In memory: a restart only loses unstarted drafts.
  const drafts = new Map<string, { text: string; call: AiCallRecord }>();

  /** Free text → brief for the person to check (one cheap text-model call). */
  app.post('/api/brief/draft', async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; productFiles?: string[] };
    if (!body.text?.trim()) return reply.code(400).send({ error: 'describe the brand and the posts you want' });
    if (config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
      return reply.code(400).send({ error: 'OPENAI_API_KEY is not set. Add it to .env and run: docker compose restart server' });
    }
    const ai = createAiClient(config, { fixtures: mockFixtures });
    const draft = await draftBrief(ai, { text: body.text, brandKitDir: config.BRAND_KIT_DIR, uploadedProductFiles: body.productFiles ?? [] });
    app.log.info({ purpose: draft.call.purpose, model: draft.call.model, costUsd: draft.call.costUsd }, 'brief draft');
    const draftId = draft.call.id;
    drafts.set(draftId, { text: body.text, call: draft.call });
    if (drafts.size > 50) drafts.delete(drafts.keys().next().value!);
    return { ...draft, draftId };
  });

  /**
   * Create a run. JSON `{ briefYaml }` or multipart: field `brief` (YAML) and files
   * `logo`, `products` (file names must match `imageFile` in the brief), `screenshots`.
   */
  app.post('/api/runs', async (req, reply) => {
    let briefYaml: string | undefined;
    let draftId: string | undefined;
    const uploads: { field: string; filename: string; data: Buffer }[] = [];
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') uploads.push({ field: part.fieldname, filename: part.filename, data: await part.toBuffer() });
        else if (part.fieldname === 'brief') briefYaml = String(part.value);
        else if (part.fieldname === 'draftId') draftId = String(part.value);
      }
    } else {
      ({ briefYaml, draftId } = (req.body ?? {}) as { briefYaml?: string; draftId?: string });
    }
    if (!briefYaml?.trim()) return reply.code(400).send({ error: 'brief YAML is required (field "brief" or JSON "briefYaml")' });
    // Fail here, not minutes later in stage 2.
    if (config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
      return reply.code(400).send({ error: 'OPENAI_API_KEY is not set. Add it to .env and run: docker compose restart server' });
    }

    let slug: string;
    try {
      slug = parseBriefYaml(briefYaml).brief.brand.slug;
    } catch (err) {
      const message = err instanceof BriefValidationError || err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
    for (const u of uploads) {
      if (!['logo', 'products', 'screenshots'].includes(u.field)) return reply.code(400).send({ error: `unexpected file field "${u.field}"` });
      if (!IMAGE_EXT.test(u.filename)) return reply.code(400).send({ error: `"${u.filename}" is not a PNG/JPEG/WebP image` });
    }

    const store = RunStore.create(config.RUNS_DIR, slug, config);
    store.writeText('brief', BRIEF_INPUT_FILE, briefYaml);

    // With uploads the run gets its own brand kit: the repo kit as a base, uploads on top.
    let brandKitDir = config.BRAND_KIT_DIR;
    if (uploads.length) {
      brandKitDir = path.join(store.runDir, 'brand_kit');
      const kit = path.join(brandKitDir, slug);
      const repoKit = path.join(config.BRAND_KIT_DIR, slug);
      if (existsSync(repoKit)) copyDir(repoKit, kit);
      for (const u of uploads) {
        const target =
          u.field === 'logo' ? path.join(kit, 'logo.png') : path.join(kit, u.field === 'products' ? 'products' : 'instagram', safeName(u.filename));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, u.data);
      }
    }

    db.insert(runs)
      .values({ id: store.runId, brandSlug: slug, status: 'queued', runDir: store.runDir, brandKitDir, provider: config.AI_PROVIDER, createdAt: new Date().toISOString() })
      .run();
    // The request the brief was prepared from, and the cost of preparing it, belong to the run.
    const draft = draftId ? drafts.get(draftId) : undefined;
    if (draft) {
      store.writeText('brief', 'request.txt', draft.text);
      store.recordAiCall(draft.call);
      db.insert(aiCalls).values({ ...draft.call, runId: store.runId, error: draft.call.error ?? null }).onConflictDoNothing().run();
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
    return { ...run, state: openStore(run.id).getState(), questions: questions.list(run.id) };
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
