import type { StageDefinition } from '../pipeline/types.js';
import { briefStage } from './01-brief.js';
import { analysisStage } from './02-analysis.js';
import { planStage } from './03-plan.js';
import { createStage } from './04-create.js';

export const reviewStage: StageDefinition = {
  no: 5,
  id: 'review',
  title: 'Review & package',
  async run() {
    throw new Error('Stage "review" is implemented in M4');
  },
};

export const stages: StageDefinition[] = [briefStage, analysisStage, planStage, createStage, reviewStage];

export { briefStage, analysisStage, planStage, createStage };
export { DEFAULT_FONT, buildInstagramText } from './04-create.js';
export type { CaptionRecord, ImagePromptRecord } from './04-create.js';
export { BRIEF_INPUT_FILE, checkBrandKit, listInstagramScreenshots, parseBriefYaml } from './01-brief.js';
export { confirmPrices, mergeAnalysis, parsePriceAnswer, INSTAGRAM_NO_SCREENSHOTS_REASON } from './02-analysis.js';
export type { MergeInput } from './02-analysis.js';
export { PlanValidationError, validatePlan } from './03-plan.js';
export { renderAnalysisMd, renderBriefMd, renderPlanMd, renderPostsMd } from './markdown.js';
export { mockFixtures } from '../fixtures/index.js';
