// @recipe/core — pipeline stages, Zod schemas, OpenAI client wrapper and
// image composition. Only configuration exists in M0; stages come later.
export { config, findRepoRoot, parseConfig, requireOpenAIKey, envSchema } from './config.js';
export type { Config, Env } from './config.js';

/** Ordered pipeline stages (implemented in later milestones). */
export const STAGES = ['brief', 'analysis', 'plan', 'create', 'review'] as const;
export type Stage = (typeof STAGES)[number];
