import type { AiKind } from './types.js';

// USD per 1M tokens, Standard tier, prompts <= 272K tokens; cached-input and
// cache-write discounts are ignored (we don't use prompt caching yet).
// Sources (checked 2026-10-30):
//   https://developers.openai.com/api/docs/models/gpt-6-luna   (changelog 2026-09-22)
//   https://developers.openai.com/api/docs/models/gpt-6.1-terra
//   https://developers.openai.com/api/docs/models/gpt-6.1-sol
//   https://developers.openai.com/api/docs/models/gpt-5.4-nano
//   https://developers.openai.com/api/docs/models/gpt-image-1-mini
//   https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
//   https://developers.openai.com/api/docs/guides/image-generation (GPT Image 2.5 costs)
//   https://developers.openai.com/api/docs/pricing (built-in tools: web search)

export interface TextModelPrice {
  type: 'text';
  input: number;
  output: number;
}

export interface ImageModelPrice {
  type: 'image';
  textInput: number;
  imageInput: number;
  imageOutput: number;
}

export type ModelPrice = TextModelPrice | ImageModelPrice;

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-6-luna': { type: 'text', input: 0.1, output: 0.5 },
  'gpt-6.1-terra': { type: 'text', input: 1, output: 5 },
  'gpt-6.1-sol': { type: 'text', input: 2, output: 10 },
  'gpt-5.4-nano': { type: 'text', input: 0.2, output: 1.25 },
  'gpt-image-1-mini': { type: 'image', textInput: 2, imageInput: 2.5, imageOutput: 8 },
  'gpt-image-2.5-flare': { type: 'image', textInput: 5, imageInput: 8, imageOutput: 30 },
};

/** Hosted web_search tool: $10.00 / 1k calls; search content tokens are billed as input tokens. */
export const WEB_SEARCH_USD_PER_CALL = 0.01;

export interface CostInput {
  model: string;
  kind: AiKind;
  inputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
  /** Image models only: share of inputTokens that are image tokens (rest is priced as text). */
  imageInputTokens?: number;
}

/** Looks up a model, also accepting dated snapshots like `gpt-image-2.5-flare-2026-09-08`. */
export function findPrice(model: string): ModelPrice | undefined {
  return PRICES[model] ?? PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
}

/** Estimated USD cost of one call, or null when the model is not in the price table. */
export function estimateCost(c: CostInput): number | null {
  const price = findPrice(c.model);
  if (!price) return null;
  const perM = (tokens: number, usd: number) => (tokens * usd) / 1_000_000;
  let cost: number;
  if (price.type === 'text') {
    cost = perM(c.inputTokens, price.input) + perM(c.outputTokens, price.output);
  } else {
    const imageIn = Math.min(c.imageInputTokens ?? 0, c.inputTokens);
    cost =
      perM(c.inputTokens - imageIn, price.textInput) +
      perM(imageIn, price.imageInput) +
      perM(c.outputTokens, price.imageOutput);
  }
  return cost + (c.webSearchCalls ?? 0) * WEB_SEARCH_USD_PER_CALL;
}
