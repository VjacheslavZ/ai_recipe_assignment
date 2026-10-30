import type { BrandAnalysis } from '../schemas/analysis.js';
import type { PostFormat, SlideLayout, SlidePlan } from '../schemas/plan.js';

export const BACKGROUND_PROMPT_VERSION = 'background@1';

/** Where text and product will be composited, so the model keeps that area calm. */
const SAFE_AREA: Record<SlideLayout, string> = {
  'text-only': 'Keep the upper two thirds calm and uncluttered (large headline goes there); detail may sit in the lower third.',
  'product-center': 'Keep the top quarter calm for a headline and leave an empty, well-lit surface in the lower centre where a product will be placed.',
  'product-left': 'Leave an empty, well-lit surface on the left half for a product; keep the right half calm for text.',
  'product-right': 'Leave an empty, well-lit surface on the right half for a product; keep the left half calm for text.',
};

/** Hard constraints: product, logo and copy are composited later from real assets (ADR-004). */
const NEGATIVES =
  'Absolutely no products, packaging, bottles, jars, tubs, bars or labels; no text, letters, numbers, logos, watermarks or signage; no identifiable people or faces (anonymous, out-of-focus silhouettes at most).';

/**
 * Stage 04 — image prompt for one slide background. Combines the planner's scene
 * with the brand's visual style from the analysis and the layout's safe area.
 */
export function buildBackgroundPrompt(opts: {
  slide: SlidePlan;
  format: PostFormat;
  analysis: BrandAnalysis;
}): string {
  const { slide, format, analysis } = opts;
  const colors = slide.brandColorsHex.length ? slide.brandColorsHex : analysis.visualStyle.colorsHex;
  const orientation = format === 'story' ? 'vertical 9:16 frame' : 'vertical 4:5 Instagram feed image';
  return [
    `Photographic background for a ${orientation}.`,
    `Scene: ${slide.backgroundPrompt.trim()}`,
    `Brand look: ${analysis.visualStyle.photoStyle}. Colour palette leaning on ${colors.join(', ')}.`,
    SAFE_AREA[slide.layout],
    NEGATIVES,
    'High-end commercial sports photography, realistic lighting, shallow depth of field, no frames or borders.',
  ].join('\n');
}
