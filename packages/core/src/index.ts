// @recipe/core — pipeline stages, Zod schemas, AI client wrapper, run store.
export { config, findRepoRoot, parseConfig, requireOpenAIKey, envSchema } from './config.js';
export type { Config, Env } from './config.js';

export * from './ai/index.js';
export { STAGES } from './pipeline/types.js';
export type { Stage, StageStatus, PendingQuestion, StageContext, StageDefinition } from './pipeline/types.js';
export { RUN_INPUTS_DIR, runPipeline } from './pipeline/runner.js';
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
  renderPostsMd,
  renderReviewMd,
  checkCaptionPrices,
  revisionPrompt,
  slideScore,
  DEFAULT_FONT,
  buildInstagramText,
  draftBrief,
  draftToBriefInput,
  slugFromHandle,
} from './stages/index.js';
export type { MergeInput, CaptionRecord, ImagePromptRecord, BriefDraft, DraftBriefOptions } from './stages/index.js';
export * from './compose/compose.js';
export { applyCollectedToYaml, collectBrandKit, productFileName, KIT_SOURCES_FILE } from './kit/collect.js';
export type { CollectBrandKitOptions, CollectBrandKitResult } from './kit/collect.js';
export { findLogoCandidates, findProductImages, findResultLinks, searchUrls } from './kit/extract.js';
