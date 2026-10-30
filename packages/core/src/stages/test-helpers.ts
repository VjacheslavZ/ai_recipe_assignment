// Test-only helpers (imported by *.test.ts; not exported from the package).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { AiCallRecord, AiClient, StructuredRequest } from '../ai/types.js';
import { parseConfig } from '../config.js';
import type { PendingQuestion, StageContext } from '../pipeline/types.js';
import { RunStore } from '../run/store.js';

/** Minimal AiClient returning fixtures by purpose (honours the `__sources` convention). */
export function fakeAi(fixtures: Record<string, unknown>): AiClient & { requests: StructuredRequest<unknown>[] } {
  const requests: StructuredRequest<unknown>[] = [];
  const call = (purpose: string): AiCallRecord => ({
    id: 'test', purpose, provider: 'mock', model: 'fake', kind: 'text', inputTokens: 0, outputTokens: 0,
    imageCount: 0, webSearchCalls: 0, costUsd: 0, durationMs: 0, status: 'ok', retryCount: 0, startedAt: new Date().toISOString(),
  });
  return {
    requests,
    async structured<T>(req: StructuredRequest<T>) {
      requests.push(req as StructuredRequest<unknown>);
      const { __sources, ...rest } = fixtures[req.purpose] as Record<string, unknown> & { __sources?: { url: string }[] };
      return { data: req.schema.parse(rest), sources: __sources ?? [], call: call(req.purpose) };
    },
    async generateImage(req) {
      const [width, height] = (req.size ?? '64x64').split('x').map(Number) as [number, number];
      const png = await sharp({ create: { width, height, channels: 3, background: '#335577' } }).png().toBuffer();
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
