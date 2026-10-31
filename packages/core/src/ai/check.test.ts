import type OpenAI from 'openai';
import { APIError } from 'openai';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { checkOpenAiSetup } from './check.js';

const config = parseConfig(
  { AI_PROVIDER: 'openai', OPENAI_TEXT_MODEL: 'gpt-6-luna', OPENAI_VISION_MODEL: 'gpt-6-luna', OPENAI_IMAGE_MODEL: 'gpt-image-9' },
  '/tmp',
);

function fakeClient(retrieve: (id: string) => Promise<unknown>): OpenAI {
  return { models: { retrieve } } as unknown as OpenAI;
}

describe('checkOpenAiSetup', () => {
  it('reports a missing key without calling the API', async () => {
    const res = await checkOpenAiSetup(config);
    expect(res).toMatchObject({ ok: false, keySet: false });
    expect(res.error).toMatch(/OPENAI_API_KEY is not set/);
  });

  it('flags unknown models, unpriced models and shutdown dates', async () => {
    const client = fakeClient(async (id) => {
      if (id === 'gpt-image-9') throw APIError.generate(404, undefined, 'not found', new Headers());
      return { id, shutdown_date: '2027-01-01' };
    });
    const res = await checkOpenAiSetup(config, client);
    expect(res.ok).toBe(false);
    expect(res.models[0]).toMatchObject({ role: 'text', available: true, priced: true, shutdownDate: '2027-01-01' });
    expect(res.models[2]).toMatchObject({ role: 'image', model: 'gpt-image-9', available: false, priced: false, error: 'model not found for this key' });
  });

  it('stops at a rejected key instead of blaming each model', async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls++;
      throw APIError.generate(401, undefined, 'bad key', new Headers());
    });
    const res = await checkOpenAiSetup(config, client);
    expect(calls).toBe(1);
    expect(res).toMatchObject({ ok: false, keySet: true, models: [] });
    expect(res.error).toMatch(/rejected the key \(401\)/);
  });
});
