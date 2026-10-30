import { z } from 'zod';
import { HEX_COLOR } from './analysis.js';

export const PostFormatSchema = z.enum(['carousel', 'single', 'story']);
export type PostFormat = z.infer<typeof PostFormatSchema>;

export const PostGoalSchema = z.enum(['education', 'engagement', 'saves', 'product_intro', 'purchase_intent']);
export type PostGoal = z.infer<typeof PostGoalSchema>;

export const SlideLayoutSchema = z.enum(['product-left', 'product-right', 'product-center', 'text-only']);
export type SlideLayout = z.infer<typeof SlideLayoutSchema>;

/** Allowed number of slides/frames per format (inclusive). Stories are 9:16 frames. */
export const SLIDE_COUNT: Record<PostFormat, { min: number; max: number }> = {
  carousel: { min: 3, max: 6 },
  single: { min: 1, max: 1 },
  story: { min: 2, max: 3 },
};

// Model-facing shape (strict structured outputs: all fields required, nullable
// instead of optional, no min/max/pattern). Counts, ids and product names are
// validated in code by `validatePlan`.
const slideShape = {
  index: z.number().describe('1-based position of the slide/frame within the post.'),
  role: z.string().describe('Purpose of the slide, e.g. hook, tip, product, cta.'),
  headlineHr: z.string().describe('On-image headline in Croatian, short (max ~7 words).'),
  headlineEn: z.string().describe('English gloss of the headline.'),
  subtextHr: z.string().nullable().describe('Optional on-image supporting line in Croatian.'),
  subtextEn: z.string().nullable().describe('English gloss of subtextHr.'),
  productName: z.string().nullable().describe('Exact product name from the analysis, or null for no product.'),
  showPrice: z.boolean().describe('true only if the product price is marked as usable in the analysis.'),
  backgroundPrompt: z
    .string()
    .describe('English prompt for the image model: scene only — no product, no text, no logos, no faces.'),
  layout: SlideLayoutSchema,
  brandColorsHex: z.array(z.string()).describe('Brand colours (uppercase HEX) to use on this slide.'),
};

const postShape = {
  number: z.number().describe('Post number: 1, 2 or 3.'),
  format: PostFormatSchema,
  goal: PostGoalSchema,
  concept: z.string(),
  rationale: z.string().describe('Why this fits the brand, referencing analysis findings and fact ids.'),
  captionHr: z.string().describe('Instagram caption in Croatian.'),
  captionEn: z.string().describe('English gloss of the caption.'),
  hashtags: z.array(z.string()),
  cta: z.string().describe('Call to action in Croatian.'),
  factIds: z.array(z.string()).describe('Ids of verified facts this post relies on.'),
};

export const ContentPlanModelSchema = z.object({
  summary: z.string().describe('2–3 sentences: overall idea of the three-post set.'),
  posts: z.array(z.object({ ...postShape, slides: z.array(z.object(slideShape)) })),
});
export type ContentPlanModel = z.infer<typeof ContentPlanModelSchema>;

// Artifact shape (`03_plan/plan.json`), stricter than the model shape.
export const SlidePlanSchema = z.object({
  ...slideShape,
  index: z.number().int().min(1),
  brandColorsHex: z.array(z.string().regex(HEX_COLOR)),
});
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

export const PostPlanSchema = z.object({
  ...postShape,
  number: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  slides: z.array(SlidePlanSchema).min(1),
});
export type PostPlan = z.infer<typeof PostPlanSchema>;

export const ContentPlanSchema = z.object({
  summary: z.string(),
  posts: z.array(PostPlanSchema).length(3),
});
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
