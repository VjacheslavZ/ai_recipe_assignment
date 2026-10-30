import { describe, expect, it } from 'vitest';
import { estimateCost, WEB_SEARCH_USD_PER_CALL } from './pricing.js';

describe('estimateCost', () => {
  it('prices text models per 1M tokens', () => {
    expect(estimateCost({ model: 'gpt-6-luna', kind: 'text', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(estimateCost({ model: 'gpt-6.1-terra', kind: 'text', inputTokens: 2000, outputTokens: 1000 })).toBeCloseTo(0.007);
  });

  it('adds the web_search per-call fee', () => {
    const base = estimateCost({ model: 'gpt-6-luna', kind: 'text', inputTokens: 0, outputTokens: 0, webSearchCalls: 3 });
    expect(base).toBeCloseTo(3 * WEB_SEARCH_USD_PER_CALL);
  });

  it('splits image-model input into text and image tokens', () => {
    const cost = estimateCost({
      model: 'gpt-image-1-mini',
      kind: 'image',
      inputTokens: 1_000_000,
      imageInputTokens: 400_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.6 * 2 + 0.4 * 2.5 + 8);
  });

  it('accepts dated snapshots and returns null for unknown models', () => {
    expect(estimateCost({ model: 'gpt-image-2.5-flare-2026-09-08', kind: 'image', inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(30);
    expect(estimateCost({ model: 'gpt-unknown', kind: 'text', inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});
