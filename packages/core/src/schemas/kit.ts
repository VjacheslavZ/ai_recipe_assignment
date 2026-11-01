import { z } from 'zod';

/** The model picks each product's page from links found by the site search (structured output). */
export const ProductPageMatchModelSchema = z.object({
  matches: z.array(
    z.object({
      product: z.string(),
      /** One of the candidate URLs, or null when none is clearly this product. */
      url: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});
export type ProductPageMatchModel = z.infer<typeof ProductPageMatchModelSchema>;

/** The vision model picks the image that is what we need (logo or packshot), or none. */
export const ImagePickModelSchema = z.object({
  /** 1-based number of the chosen image, or null when no image fits. */
  choice: z.number().int().nullable(),
  reason: z.string(),
});
export type ImagePickModel = z.infer<typeof ImagePickModelSchema>;

/** One file the collector looked for. */
export const KitItemSchema = z.object({
  kind: z.enum(['logo', 'product']),
  product: z.string().nullable(),
  /** Path relative to the kit folder (`logo.png`, `products/…`). */
  file: z.string().nullable(),
  status: z.enum(['collected', 'kept', 'not_found']),
  sourceUrl: z.string().nullable(),
  pageUrl: z.string().nullable(),
  note: z.string(),
});
export type KitItem = z.infer<typeof KitItemSchema>;

/** `sources.json` in the kit folder: where each collected file came from (R34). */
export const KitSourceSchema = z.object({
  file: z.string(),
  sourceUrl: z.string(),
  pageUrl: z.string().nullable(),
  retrievedAt: z.string(),
  checkedBy: z.string(),
  note: z.string(),
});
export type KitSource = z.infer<typeof KitSourceSchema>;
