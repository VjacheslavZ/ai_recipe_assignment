import { z } from 'zod';

// Model-facing shapes (strict structured outputs: every field required, nullable
// instead of optional, no min/max). Ranges are clamped and scores computed in code.

const criterion = (what: string) =>
  z.object({
    score: z.number().describe(`1 (unusable) to 5 (excellent): ${what}`),
    reason: z.string().describe('One concrete sentence pointing at what you see.'),
  });

export const SlideReviewModelSchema = z.object({
  brandFit: criterion('matches the brand look from the analysis (colours, mood, photo style)'),
  readability: criterion('headline and subtext are easy to read at phone size (contrast, size, nothing covering them)'),
  productAccuracy: criterion(
    'the product looks like the reference photo — shape, colours, label and logo not distorted; 5 if the slide has no product',
  ),
  goalFit: criterion("the slide supports the post's goal and role"),
  textCorrectness: criterion('on-image text is exactly the planned copy, spelled correctly incl. Croatian diacritics, no extra/garbled text'),
  issues: z.array(z.string()).describe('Concrete problems, empty if none.'),
  backgroundFix: z
    .string()
    .nullable()
    .describe('If the generated background causes a problem, an instruction to add to its prompt (e.g. "darker, calmer upper half"); otherwise null.'),
});
export type SlideReviewModel = z.infer<typeof SlideReviewModelSchema>;

export const CaptionReviewModelSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().describe('A factual statement made in the caption (about the product, brand, price, effect).'),
        factId: z.string().nullable().describe('Id of the verified fact that supports it, or null.'),
        supported: z.boolean(),
      }),
    )
    .describe('Every factual claim in the caption. Opinions, questions and CTAs are not claims.'),
  languageIssues: z.array(z.string()).describe('Spelling/grammar problems in the Croatian caption, empty if none.'),
  verdict: z.enum(['ok', 'needs_fix']),
});
export type CaptionReviewModel = z.infer<typeof CaptionReviewModelSchema>;

export const CRITERIA = ['brandFit', 'readability', 'productAccuracy', 'goalFit', 'textCorrectness'] as const;
export type Criterion = (typeof CRITERIA)[number];

// Artifact shape (`05_review/review.json`).

export const SlideAttemptSchema = z.object({
  attempt: z.number().int().min(0),
  file: z.string(),
  backgroundFile: z.string(),
  /** Mean criterion score mapped to 0–10. */
  score: z.number(),
  scores: z.record(z.string(), z.object({ score: z.number(), reason: z.string() })),
  issues: z.array(z.string()),
  backgroundFix: z.string().nullable(),
});
export type SlideAttempt = z.infer<typeof SlideAttemptSchema>;

export const SlideResultSchema = z.object({
  post: z.number().int(),
  slide: z.number().int(),
  attempts: z.array(SlideAttemptSchema).min(1),
  /** Index into `attempts` of the version shipped in `05_review/posts/`. */
  chosen: z.number().int().min(0),
  passed: z.boolean(),
});
export type SlideResult = z.infer<typeof SlideResultSchema>;

export const CaptionResultSchema = z.object({
  post: z.number().int(),
  claims: z.array(z.object({ text: z.string(), factId: z.string().nullable(), supported: z.boolean() })),
  languageIssues: z.array(z.string()),
  /** Problems found in code (prices not backed by the analysis, unknown or unverified fact ids). */
  codeIssues: z.array(z.string()),
  passed: z.boolean(),
});
export type CaptionResult = z.infer<typeof CaptionResultSchema>;

export const ReviewSchema = z.object({
  reviewedAt: z.string(),
  threshold: z.number(),
  maxRegenerations: z.number().int(),
  slides: z.array(SlideResultSchema),
  captions: z.array(CaptionResultSchema),
  passed: z.boolean(),
  /** Items a human must look at before publishing. */
  needsHumanAttention: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;
