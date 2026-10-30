// @recipe/core — pipeline stages, Zod schemas, AI client wrapper, run store.
export { config, findRepoRoot, parseConfig, requireOpenAIKey, envSchema } from './config.js';
export type { Config, Env } from './config.js';

export * from './ai/index.js';
export { STAGES } from './pipeline/types.js';
export type { Stage, StageStatus, PendingQuestion, StageContext, StageDefinition } from './pipeline/types.js';
export { runPipeline } from './pipeline/runner.js';
export type { RunPipelineOptions, RunPipelineResult } from './pipeline/runner.js';
export { RunStore, stageDirName, slugify } from './run/store.js';
export type { RunState, StageState, StoredAiCall, CostBucket, CostReport } from './run/store.js';
export { writeFileAtomic, compactTimestamp } from './fs.js';

export * from './schemas/index.js';
export * from './prompts/index.js';
export {
  stages,
  briefStage,
  analysisStage,
  planStage,
  createStage,
  reviewStage,
  mockFixtures,
  BRIEF_INPUT_FILE,
  checkBrandKit,
  listInstagramScreenshots,
  parseBriefYaml,
  confirmPrices,
  mergeAnalysis,
  parsePriceAnswer,
  INSTAGRAM_NO_SCREENSHOTS_REASON,
  PlanValidationError,
  validatePlan,
  renderAnalysisMd,
  renderBriefMd,
  renderPlanMd,
} from './stages/index.js';
export type { MergeInput } from './stages/index.js';
