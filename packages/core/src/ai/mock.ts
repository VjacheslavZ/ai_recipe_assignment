import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Config } from '../config.js';
import type {
  AiCallRecord,
  AiClient,
  AiKind,
  ImageRequest,
  ImageResult,
  MockFixtures,
  OnAiCall,
  Source,
  StructuredRequest,
  StructuredResult,
} from './types.js';

/**
 * Mock provider (ADR-019): returns schema-valid fixtures and placeholder PNGs.
 *
 * Fixture lookup: `fixtures[req.purpose]`; if absent, the purpose is shortened
 * one dot-segment at a time (`create.caption.post1` → `create.caption` → `create`),
 * so one fixture can serve per-item purposes.
 *
 * `__sources` convention: a fixture object may carry `__sources: Source[]`. It is
 * stripped before schema validation and returned as `StructuredResult.sources`,
 * standing in for the url_citation annotations of a real web_search call.
 */
export const MOCK_SOURCES_KEY = '__sources';

export type MockConfig = Pick<Config, 'OPENAI_TEXT_MODEL' | 'OPENAI_VISION_MODEL' | 'OPENAI_IMAGE_MODEL' | 'IMAGE_SIZE'>;

export interface MockClientOptions {
  fixtures?: MockFixtures;
  onCall?: OnAiCall;
  delayMs?: number;
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

function findFixture(fixtures: MockFixtures, purpose: string): unknown {
  for (let key = purpose; ; key = key.slice(0, key.lastIndexOf('.'))) {
    if (Object.hasOwn(fixtures, key)) return fixtures[key];
    if (!key.includes('.')) break;
  }
  const known = Object.keys(fixtures).sort().join(', ') || '(none)';
  throw new Error(`Mock AI: no fixture for purpose "${purpose}". Known purposes: ${known}`);
}

function splitSources(fixture: unknown): { data: unknown; sources: Source[] } {
  if (fixture && typeof fixture === 'object' && !Array.isArray(fixture) && MOCK_SOURCES_KEY in fixture) {
    const { [MOCK_SOURCES_KEY]: sources, ...data } = fixture as Record<string, unknown>;
    return { data, sources: Array.isArray(sources) ? (sources as Source[]) : [] };
  }
  return { data: fixture, sources: [] };
}

export function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1024, height: 1024 };
}

export function createMockClient(config: MockConfig, opts: MockClientOptions = {}): AiClient {
  const fixtures = opts.fixtures ?? {};
  const delayMs = opts.delayMs ?? 50;

  async function record(
    meta: { purpose: string; model: string; kind: AiKind },
    startedAt: Date,
    usage: Pick<AiCallRecord, 'inputTokens' | 'outputTokens' | 'imageCount' | 'webSearchCalls'>,
    error?: string,
  ): Promise<AiCallRecord> {
    const rec: AiCallRecord = {
      id: randomUUID(),
      provider: 'mock',
      ...meta,
      ...usage,
      costUsd: 0,
      durationMs: Date.now() - startedAt.getTime(),
      status: error === undefined ? 'ok' : 'error',
      retryCount: 0,
      startedAt: startedAt.toISOString(),
      ...(error === undefined ? {} : { error }),
    };
    opts.onCall?.(rec);
    return rec;
  }

  const sleep = () => new Promise<void>((r) => setTimeout(r, delayMs));

  return {
    async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const startedAt = new Date();
      const kind = req.model ?? (req.images?.length ? 'vision' : 'text');
      const model = kind === 'vision' ? config.OPENAI_VISION_MODEL : config.OPENAI_TEXT_MODEL;
      const meta = { purpose: req.purpose, model, kind };
      const usageBase = {
        inputTokens: approxTokens(req.system + req.input),
        imageCount: 0,
        webSearchCalls: req.webSearch ? 1 : 0,
      };
      await sleep();
      try {
        const { data, sources } = splitSources(findFixture(fixtures, req.purpose));
        const parsed = req.schema.safeParse(data);
        if (!parsed.success) {
          throw new Error(
            `Mock AI: fixture for "${req.purpose}" does not match schema "${req.schemaName}": ${parsed.error.message}`,
          );
        }
        const call = await record(meta, startedAt, { ...usageBase, outputTokens: approxTokens(JSON.stringify(data)) });
        return { data: parsed.data, sources, call };
      } catch (err) {
        await record(meta, startedAt, { ...usageBase, outputTokens: 0 }, (err as Error).message);
        throw err;
      }
    },

    async generateImage(req: ImageRequest): Promise<ImageResult> {
      const startedAt = new Date();
      const { width, height } = parseSize(req.size ?? config.IMAGE_SIZE);
      const hash = createHash('sha256').update(req.prompt).digest();
      await sleep();
      // An edit keeps the input image where the mask is opaque (the product), like the real model should.
      const kept = req.edit
        ? [{ input: await sharp(req.edit.image).removeAlpha().joinChannel(await sharp(req.edit.mask).extractChannel('alpha').png().toBuffer()).png().toBuffer() }]
        : [];
      const png = await sharp({
        create: { width, height, channels: 3, background: { r: hash[0] ?? 0, g: hash[1] ?? 0, b: hash[2] ?? 0 } },
      })
        .composite(kept)
        .png()
        .toBuffer();
      const call = await record({ purpose: req.purpose, model: config.OPENAI_IMAGE_MODEL, kind: 'image' }, startedAt, {
        inputTokens: approxTokens(req.prompt),
        outputTokens: 0,
        imageCount: 1,
        webSearchCalls: 0,
      });
      return { png, call };
    },
  };
}
