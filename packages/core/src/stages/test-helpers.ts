// Test-only helpers (imported by *.test.ts; not exported from the package).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { AiCallRecord, AiClient, ImageRequest, StructuredRequest } from '../ai/types.js';
import { findRepoRoot, parseConfig } from '../config.js';
import { FIXTURE_BRIEF, instagramFixture, planFixture, siteFixture, siteFixtureSources } from '../fixtures/index.js';
import type { ContentPlanModel } from '../schemas/plan.js';
import { checkBrandKit, parseBriefYaml } from './01-brief.js';
import { mergeAnalysis } from './02-analysis.js';
import { validatePlan } from './03-plan.js';
import type { PendingQuestion, StageContext } from '../pipeline/types.js';
import { RunStore } from '../run/store.js';

/** Minimal AiClient returning fixtures by purpose (honours the `__sources` convention). */
export function fakeAi(fixtures: Record<string, unknown>): AiClient & { requests: StructuredRequest<unknown>[]; imageRequests: ImageRequest[] } {
  const requests: StructuredRequest<unknown>[] = [];
  const imageRequests: ImageRequest[] = [];
  const call = (purpose: string): AiCallRecord => ({
    id: 'test', purpose, provider: 'mock', model: 'fake', kind: 'text', inputTokens: 0, outputTokens: 0,
    imageCount: 0, webSearchCalls: 0, costUsd: 0, durationMs: 0, status: 'ok', retryCount: 0, startedAt: new Date().toISOString(),
  });
  return {
    requests,
    imageRequests,
    async structured<T>(req: StructuredRequest<T>) {
      requests.push(req as StructuredRequest<unknown>);
      const { __sources, ...rest } = fixtures[req.purpose] as Record<string, unknown> & { __sources?: { url: string }[] };
      return { data: req.schema.parse(rest), sources: __sources ?? [], call: call(req.purpose) };
    },
    async generateImage(req) {
      imageRequests.push(req);
      const [width, height] = (req.size ?? '64x64').split('x').map(Number) as [number, number];
      // Like a model that respects the mask: an edit keeps the product and paints the rest.
      const kept = req.edit
        ? [{ input: await sharp(req.edit.image).removeAlpha().joinChannel(await sharp(req.edit.mask).extractChannel('alpha').png().toBuffer()).png().toBuffer() }]
        : [];
      const png = await sharp({ create: { width, height, channels: 3, background: '#335577' } }).composite(kept).png().toBuffer();
      return { png, call: { ...call(req.purpose), kind: 'image', imageCount: 1 } };
    },
  };
}

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `recipe-${prefix}-`));
}

export function makeContext(opts: {
  ai: AiClient;
  brandKitDir: string;
  ask?: (q: PendingQuestion) => Promise<string | null>;
}): StageContext & { logs: string[]; questions: PendingQuestion[] } {
  const runsDir = tempDir('runs');
  const store = RunStore.create(runsDir, 'gymbeamhr', {});
  const logs: string[] = [];
  const questions: PendingQuestion[] = [];
  return {
    runId: store.runId,
    runDir: store.runDir,
    config: parseConfig({ AI_PROVIDER: 'mock' }, runsDir),
    ai: opts.ai,
    store,
    brandKitDir: opts.brandKitDir,
    log: (m) => logs.push(m),
    ask: async (q) => {
      questions.push(q);
      return opts.ask ? opts.ask(q) : null;
    },
    logs,
    questions,
  };
}

/**
 * A run whose stages 01–03 are done (artifacts written from the fixtures), with a
 * temp brand kit holding a logo and a photo for the first product that has an image file.
 */
export async function prepareRunThroughPlan(ai: AiClient) {
  const { brief } = parseBriefYaml(readFileSync(path.join(findRepoRoot(), FIXTURE_BRIEF), 'utf8'));
  const brandKitDir = tempDir('kit');
  const kit = path.join(brandKitDir, brief.brand.slug);
  mkdirSync(path.join(kit, 'products'), { recursive: true });
  const white = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } });
  writeFileSync(path.join(kit, 'logo.png'), await white(300, 100).png().toBuffer());
  const withImage = brief.products.find((p) => p.imageFile)!;
  const tub = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#111' } }).png().toBuffer();
  writeFileSync(path.join(kit, 'products', withImage.imageFile!), await white(400, 500).composite([{ input: tub, left: 100, top: 100 }]).png().toBuffer());

  const ctx = makeContext({ ai, brandKitDir });
  ctx.store.writeJson('brief', 'brief.json', { ...brief, brandKit: checkBrandKit(brandKitDir, brief), warnings: [] });
  const analysis = mergeAnalysis({ brief, site: siteFixture, siteSources: siteFixtureSources, instagram: instagramFixture, screenshots: ['01.png', '02.png'], now: '2026-10-30T12:00:00.000Z' });
  ctx.store.writeJson('analysis', 'analysis.json', analysis);
  const { plan } = validatePlan(structuredClone(planFixture) as ContentPlanModel, analysis);
  ctx.store.writeJson('plan', 'plan.json', plan);
  return { ctx, plan, analysis, brief };
}
