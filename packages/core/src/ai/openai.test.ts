import type OpenAI from 'openai';
import { APIError } from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseConfig } from '../config.js';
import { createOpenAiClient } from './openai.js';
import type { AiCallRecord } from './types.js';

// Offline: a fake SDK client stands in for the network; no API key is needed.
const config = parseConfig({ AI_PROVIDER: 'openai', OPENAI_TEXT_MODEL: 'gpt-6-luna' }, '/tmp');
const schema = z.object({ title: z.string() });

function fakeClient(parse: (body: Record<string, unknown>) => Promise<unknown>): OpenAI {
  return { responses: { parse }, images: { generate: async () => ({}) } } as unknown as OpenAI;
}

describe('OpenAI provider (fake transport)', () => {
  it('builds the request, extracts deduped sources and records usage/cost', async () => {
    const calls: AiCallRecord[] = [];
    let body: Record<string, unknown> = {};
    const cite = (url: string) => ({ type: 'url_citation', url, title: 'T', start_index: 0, end_index: 1 });
    const client = fakeClient(async (b) => {
      body = b;
      return {
        output: [
          { type: 'web_search_call' },
          { type: 'message', content: [{ type: 'output_text', annotations: [cite('https://a.hr'), cite('https://a.hr'), cite('https://b.hr')] }] },
        ],
        output_parsed: { title: 'ok' },
        output_text: '{"title":"ok"}',
        usage: { input_tokens: 1000, output_tokens: 100 },
      };
    });
    const ai = createOpenAiClient(config, { client, onCall: (c) => calls.push(c) });
    const res = await ai.structured({
      purpose: 'analysis.site',
      schema,
      schemaName: 'site',
      system: 'sys',
      input: 'in',
      webSearch: { allowedDomains: ['gymbeam.hr'], country: 'HR' },
    });
    expect(res.data).toEqual({ title: 'ok' });
    expect(res.sources.map((s) => s.url)).toEqual(['https://a.hr', 'https://b.hr']);
    expect(body.tools).toEqual([
      { type: 'web_search', filters: { allowed_domains: ['gymbeam.hr'] }, user_location: { type: 'approximate', country: 'HR' } },
    ]);
    expect(calls[0]).toMatchObject({ provider: 'openai', webSearchCalls: 1, inputTokens: 1000, status: 'ok' });
    expect(calls[0]?.costUsd).toBeCloseTo(1000 * 0.1e-6 + 100 * 0.5e-6 + 0.01);
  });

  it('records a failed call after retries are exhausted', async () => {
    const calls: AiCallRecord[] = [];
    const client = fakeClient(async () => {
      throw APIError.generate(500, undefined, 'server down', new Headers());
    });
    const ai = createOpenAiClient(config, { client, onCall: (c) => calls.push(c), retry: { sleep: async () => {} } });
    await expect(ai.structured({ purpose: 'plan', schema, schemaName: 's', system: '', input: '' })).rejects.toThrow(
      /"plan".*after 3 retries/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'error', retryCount: 3 });
  });
});
