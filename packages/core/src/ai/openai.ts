import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { Config } from '../config.js';
import { requireOpenAIKey } from '../config.js';
import { estimateCost } from './pricing.js';
import { RetryError, withRetry, type RetryOptions } from './retry.js';
import type {
  AiCallRecord,
  AiClient,
  AiKind,
  ImageRequest,
  ImageResult,
  OnAiCall,
  Source,
  StructuredRequest,
  StructuredResult,
} from './types.js';

const TEXT_TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 180_000;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function toDataUrl(file: string): Promise<string> {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type for ${file} (use png, jpg or webp)`);
  return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
}

export interface OpenAiClientOptions {
  onCall?: OnAiCall;
  retry?: RetryOptions;
  /** Injectable for tests; defaults to a real client built from OPENAI_API_KEY. */
  client?: OpenAI;
}

type Usage = Pick<AiCallRecord, 'inputTokens' | 'outputTokens' | 'imageCount' | 'webSearchCalls'> & {
  imageInputTokens?: number;
};

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, imageCount: 0, webSearchCalls: 0 };

export function createOpenAiClient(config: Config, opts: OpenAiClientOptions = {}): AiClient {
  // SDK retries are disabled so our own loop can count and log them.
  const client = opts.client ?? new OpenAI({ apiKey: requireOpenAIKey(config), maxRetries: 0 });

  /** Runs one logical call with retries and always emits exactly one AiCallRecord. */
  async function tracked<T>(
    meta: { purpose: string; model: string; kind: AiKind },
    fn: () => Promise<{ value: T; usage: Usage }>,
  ): Promise<{ value: T; call: AiCallRecord }> {
    const startedAt = new Date();
    const finish = (usage: Usage, retryCount: number, error?: string): AiCallRecord => {
      const rec: AiCallRecord = {
        id: randomUUID(),
        purpose: meta.purpose,
        provider: 'openai',
        model: meta.model,
        kind: meta.kind,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        imageCount: usage.imageCount,
        webSearchCalls: usage.webSearchCalls,
        costUsd: estimateCost({ ...meta, ...usage }),
        durationMs: Date.now() - startedAt.getTime(),
        status: error === undefined ? 'ok' : 'error',
        retryCount,
        startedAt: startedAt.toISOString(),
        ...(error === undefined ? {} : { error }),
      };
      opts.onCall?.(rec);
      return rec;
    };
    try {
      const { value, retryCount } = await withRetry(fn, opts.retry);
      return { value: value.value, call: finish(value.usage, retryCount) };
    } catch (err) {
      const retryCount = err instanceof RetryError ? err.retryCount : 0;
      const cause = err instanceof RetryError ? err.cause : err;
      const message = cause instanceof Error ? cause.message : String(cause);
      finish(NO_USAGE, retryCount, message);
      throw new Error(`OpenAI call "${meta.purpose}" (${meta.model}) failed after ${retryCount} retries: ${message}`, {
        cause,
      });
    }
  }

  return {
    async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const images = req.images ?? [];
      const which = req.model ?? (images.length > 0 ? 'vision' : 'text');
      const model = which === 'vision' ? config.OPENAI_VISION_MODEL : config.OPENAI_TEXT_MODEL;
      const imageParts = await Promise.all(
        images.map(async (file) => ({
          type: 'input_image' as const,
          image_url: await toDataUrl(file),
          detail: 'auto' as const,
        })),
      );
      const ws = req.webSearch;
      const tools = ws
        ? [
            {
              type: 'web_search' as const,
              ...(ws.allowedDomains?.length ? { filters: { allowed_domains: ws.allowedDomains } } : {}),
              ...(ws.country || ws.city
                ? {
                    user_location: {
                      type: 'approximate' as const,
                      ...(ws.country ? { country: ws.country } : {}),
                      ...(ws.city ? { city: ws.city } : {}),
                    },
                  }
                : {}),
            },
          ]
        : undefined;

      const { value, call } = await tracked({ purpose: req.purpose, model, kind: which }, async () => {
        const resp = await client.responses.parse(
          {
            model,
            instructions: req.system,
            input: [{ role: 'user', content: [{ type: 'input_text', text: req.input }, ...imageParts] }],
            text: { format: zodTextFormat(req.schema, req.schemaName) },
            ...(tools ? { tools } : {}),
          },
          { timeout: TEXT_TIMEOUT_MS },
        );
        const sources = new Map<string, Source>();
        let webSearchCalls = 0;
        for (const item of resp.output) {
          if (item.type === 'web_search_call') webSearchCalls++;
          if (item.type !== 'message') continue;
          for (const part of item.content) {
            if (part.type !== 'output_text') continue;
            for (const a of part.annotations) {
              if (a.type === 'url_citation' && !sources.has(a.url)) {
                sources.set(a.url, a.title ? { url: a.url, title: a.title } : { url: a.url });
              }
            }
          }
        }
        const usage: Usage = {
          inputTokens: resp.usage?.input_tokens ?? 0,
          outputTokens: resp.usage?.output_tokens ?? 0,
          imageCount: 0,
          webSearchCalls,
        };
        if (resp.output_parsed == null) {
          // Refusal or empty output: not retryable, surface the raw text for debugging.
          throw new Error(`No structured output for schema "${req.schemaName}": ${resp.output_text.slice(0, 500)}`);
        }
        // Re-validate with the caller's schema so transforms/refinements apply exactly as in the mock.
        const data = req.schema.parse(resp.output_parsed);
        return { value: { data, sources: [...sources.values()] }, usage };
      });
      return { ...value, call };
    },

    async generateImage(req: ImageRequest): Promise<ImageResult> {
      const model = config.OPENAI_IMAGE_MODEL;
      const { value, call } = await tracked({ purpose: req.purpose, model, kind: 'image' }, async () => {
        const params = {
          model,
          prompt: req.prompt,
          n: 1,
          size: (req.size ?? config.IMAGE_SIZE) as OpenAI.Images.ImageGenerateParams['size'],
          quality: (req.quality ?? config.IMAGE_QUALITY) as OpenAI.Images.ImageGenerateParams['quality'],
          output_format: 'png' as const,
        };
        const resp = req.edit
          ? await client.images.edit(
              {
                ...params,
                size: params.size as OpenAI.Images.ImageEditParams['size'],
                quality: params.quality as OpenAI.Images.ImageEditParams['quality'],
                image: await toFile(req.edit.image, 'scene.png', { type: 'image/png' }),
                mask: await toFile(req.edit.mask, 'mask.png', { type: 'image/png' }),
              },
              { timeout: IMAGE_TIMEOUT_MS },
            )
          : await client.images.generate(params, { timeout: IMAGE_TIMEOUT_MS });
        const b64 = resp.data?.[0]?.b64_json;
        if (!b64) throw new Error('Image response contained no b64_json data');
        const u = resp.usage;
        const usage: Usage = {
          inputTokens: u?.input_tokens ?? 0,
          outputTokens: u?.output_tokens ?? 0,
          imageCount: 1,
          webSearchCalls: 0,
          imageInputTokens: u?.input_tokens_details?.image_tokens ?? 0,
        };
        return { value: Buffer.from(b64, 'base64'), usage };
      });
      return { png: value, call };
    },
  };
}
