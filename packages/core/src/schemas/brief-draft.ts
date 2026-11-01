import { z } from 'zod';

/**
 * What the model returns when it turns a free-text request into a brief (structured output).
 * Every field is present; unknown values are null or empty so code can tell "not said" from "said".
 */
export const BriefDraftModelSchema = z.object({
  brand: z.object({
    name: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    website: z.string().nullable(),
    shopUrls: z.array(z.string()),
    whyThisBrand: z.string().nullable(),
  }),
  products: z.array(
    z.object({
      name: z.string(),
      url: z.string().nullable(),
      imageFile: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  audience: z.string().nullable(),
  goals: z.array(z.string()),
  references: z.array(z.object({ url: z.string(), note: z.string().nullable() })),
  constraints: z.array(z.string()),
  notes: z.string().nullable(),
  /** Fields the model filled in itself (not stated in the text), e.g. a proposed audience. */
  assumptions: z.array(z.object({ field: z.string(), value: z.string() })),
});
export type BriefDraftModel = z.infer<typeof BriefDraftModelSchema>;
