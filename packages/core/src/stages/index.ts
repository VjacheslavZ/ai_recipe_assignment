import type { StageDefinition } from '../pipeline/types.js';
import { briefStage } from './01-brief.js';
import { analysisStage } from './02-analysis.js';
import { planStage } from './03-plan.js';

export const createStage: StageDefinition = {
  no: 4,
  id: 'create',
  title: 'Create posts',
  async run() {
    throw new Error('Stage "create" is implemented in M3');
  },
};

export const reviewStage: StageDefinition = {
  no: 5,
  id: 'review',
  title: 'Review & package',
  async run() {
    throw new Error('Stage "review" is implemented in M4');
  },
};

export const stages: StageDefinition[] = [briefStage, analysisStage, planStage, createStage, reviewStage];

export { briefStage, analysisStage, planStage };
export { BRIEF_INPUT_FILE, checkBrandKit, listInstagramScreenshots, parseBriefYaml } from './01-brief.js';
export { confirmPrices, mergeAnalysis, parsePriceAnswer, INSTAGRAM_NO_SCREENSHOTS_REASON } from './02-analysis.js';
export type { MergeInput } from './02-analysis.js';
export { PlanValidationError, validatePlan } from './03-plan.js';
export { renderAnalysisMd, renderBriefMd, renderPlanMd } from './markdown.js';
export { mockFixtures } from '../fixtures/index.js';
