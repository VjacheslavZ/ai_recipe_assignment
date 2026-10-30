import { describe, expect, it } from 'vitest';
import { parseConfig, requireOpenAIKey } from './config.js';

describe('parseConfig', () => {
  it('applies defaults and resolves paths against the root', () => {
    const cfg = parseConfig({}, '/repo');
    expect(cfg.QA_SCORE_THRESHOLD).toBe(7);
    expect(cfg.MAX_REGENERATIONS).toBe(1);
    expect(cfg.PORT).toBe(3001);
    expect(cfg.DATABASE_PATH).toBe('/repo/data/recipe.db');
    expect(cfg.OPENAI_API_KEY).toBeUndefined();
  });

  it('coerces numbers and rejects invalid values', () => {
    expect(parseConfig({ PORT: '4000', OPENAI_API_KEY: '' }, '/repo').PORT).toBe(4000);
    expect(() => parseConfig({ QA_SCORE_THRESHOLD: '11' }, '/repo')).toThrow(/QA_SCORE_THRESHOLD/);
    expect(() => parseConfig({ IMAGE_QUALITY: 'ultra' }, '/repo')).toThrow(/IMAGE_QUALITY/);
  });
});

describe('requireOpenAIKey', () => {
  it('throws a clear error when the key is missing', () => {
    expect(() => requireOpenAIKey({ OPENAI_API_KEY: undefined })).toThrow(/OPENAI_API_KEY is not set/);
    expect(requireOpenAIKey({ OPENAI_API_KEY: 'sk-test' })).toBe('sk-test');
  });
});
