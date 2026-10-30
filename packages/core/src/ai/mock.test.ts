import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockClient } from './mock.js';
import type { AiCallRecord } from './types.js';

const cfg = {
  OPENAI_TEXT_MODEL: 'gpt-6-luna',
  OPENAI_VISION_MODEL: 'gpt-6-luna',
  OPENAI_IMAGE_MODEL: 'gpt-image-1-mini',
  IMAGE_SIZE: '1024x1024',
};
const schema = z.object({ name: z.string(), score: z.number() });
const req = (purpose: string) => ({ purpose, schema, schemaName: 'thing', system: 'sys', input: 'hello' });

function setup(fixtures: Record<string, unknown>) {
  const calls: AiCallRecord[] = [];
  const ai = createMockClient(cfg, { fixtures, onCall: (c) => calls.push(c), delayMs: 0 });
  return { ai, calls };
}

describe('mock AI client', () => {
  it('returns the validated fixture and strips __sources', async () => {
    const { ai, calls } = setup({
      'analysis.site': { name: 'GymBeam', score: 8, __sources: [{ url: 'https://gymbeam.hr', title: 'GymBeam' }] },
    });
    const res = await ai.structured(req('analysis.site'));
    expect(res.data).toEqual({ name: 'GymBeam', score: 8 });
    expect(res.sources).toEqual([{ url: 'https://gymbeam.hr', title: 'GymBeam' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: 'mock', purpose: 'analysis.site', costUsd: 0, status: 'ok', kind: 'text' });
  });

  it('falls back to a shorter purpose prefix', async () => {
    const { ai } = setup({ create: { name: 'x', score: 1 } });
    await expect(ai.structured(req('create.caption.post1'))).resolves.toMatchObject({ data: { name: 'x' } });
  });

  it('errors clearly on a missing purpose and records the failed call', async () => {
    const { ai, calls } = setup({ plan: { name: 'x', score: 1 } });
    await expect(ai.structured(req('review'))).rejects.toThrow(/no fixture for purpose "review".*plan/);
    expect(calls[0]?.status).toBe('error');
  });

  it('errors on a fixture that does not match the schema', async () => {
    const { ai } = setup({ plan: { name: 'x', score: 'high' } });
    await expect(ai.structured(req('plan'))).rejects.toThrow(/does not match schema "thing"/);
  });

  it('generates a PNG of the requested size', async () => {
    const { ai, calls } = setup({});
    const { png } = await ai.generateImage({ purpose: 'create.bg', prompt: 'gym at dawn', size: '640x480' });
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 640, height: 480 });
    expect(calls[0]).toMatchObject({ kind: 'image', imageCount: 1, model: 'gpt-image-1-mini', costUsd: 0 });
  });
});
