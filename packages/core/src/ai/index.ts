import type { Config } from '../config.js';
import { createMockClient } from './mock.js';
import { createOpenAiClient } from './openai.js';
import type { AiClient, MockFixtures, OnAiCall } from './types.js';

export interface CreateAiClientOptions {
  onCall?: OnAiCall;
  /** Used only when AI_PROVIDER=mock. */
  fixtures?: MockFixtures;
}

/** Picks the provider from `config.AI_PROVIDER` (ADR-019). */
export function createAiClient(config: Config, opts: CreateAiClientOptions = {}): AiClient {
  return config.AI_PROVIDER === 'mock'
    ? createMockClient(config, { fixtures: opts.fixtures, onCall: opts.onCall })
    : createOpenAiClient(config, { onCall: opts.onCall });
}

export * from './types.js';
export { checkOpenAiSetup } from './check.js';
export type { ModelCheck, OpenAiCheck } from './check.js';
export { createMockClient, MOCK_SOURCES_KEY } from './mock.js';
export { createOpenAiClient } from './openai.js';
export { estimateCost, findPrice, PRICES, WEB_SEARCH_USD_PER_CALL } from './pricing.js';
export type { CostInput, ModelPrice } from './pricing.js';
