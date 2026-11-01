import type { BrandAnalysis } from '../schemas/analysis.js';
import type { PostFormat, SlideLayout, SlidePlan } from '../schemas/plan.js';

export const BACKGROUND_PROMPT_VERSION = 'background@2';

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

/** Where the product already stands in the edit input, so the model builds the scene around it. */
const SCENE_AREA: Record<Exclude<SlideLayout, 'text-only'>, string> = {
  'product-center': 'Keep the top quarter calm for a headline.',
  'product-left': 'Keep the right half calm for text.',
  'product-right': 'Keep the left half calm for text.',
};

/** Edit mode: the real product is in the input image and is pasted over the result again (ADR-004). */
const SCENE_RULES = (product: string) =>
  `The input image shows the real ${product} on a plain grey canvas. Keep the product exactly where and as it is: same size, shape, packaging and label; do not redraw, move, resize or restyle it. ` +
  'Replace the grey with the scene and make the product belong to it: a surface it stands on at a believable perspective, lighting that matches the soft frontal studio light on the product, a natural contact shadow and subtle reflections. ' +
  'The scene colours should make the packaging stand out (contrast with its colours, not the same tone behind it). ' +
  'Add no other products, packaging, bottles, jars, tubs or bars; no text, letters, numbers, logos, watermarks or signage; no identifiable people or faces.';

/**
 * Stage 04 — image prompt for one slide background. Combines the planner's scene
 * with the brand's visual style from the analysis and the layout's safe area.
 */
export function buildBackgroundPrompt(opts: {
  slide: SlidePlan;
  format: PostFormat;
  analysis: BrandAnalysis;
  /** Set in edit mode: the background is painted around this product (see productSceneInput). */
  productInScene?: string;
}): string {
  const { slide, format, analysis, productInScene } = opts;
  const colors = slide.brandColorsHex.length ? slide.brandColorsHex : analysis.visualStyle.colorsHex;
  const orientation = format === 'story' ? 'vertical 9:16 frame' : 'vertical 4:5 Instagram feed image';
  return [
    productInScene ? `Edit of the input image: paint the background around the existing product for a ${orientation}.` : `Photographic background for a ${orientation}.`,
    `Scene: ${slide.backgroundPrompt.trim()}`,
    `Brand look: ${analysis.visualStyle.photoStyle}. Colour palette leaning on ${colors.join(', ')}.`,
    ...(productInScene && slide.layout !== 'text-only'
      ? [SCENE_AREA[slide.layout], SCENE_RULES(productInScene)]
      : [SAFE_AREA[slide.layout], NEGATIVES]),
    'High-end commercial sports photography, realistic lighting, shallow depth of field, no frames or borders.',
  ].join('\n');
}
