import { z } from 'zod';

export const HEX_COLOR = /^#[0-9A-F]{6}$/;

export const FactStatusSchema = z.enum(['verified', 'assumption', 'unavailable']);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const PriceStatusSchema = z.enum(['verified', 'pending_confirmation', 'confirmed_by_user', 'omitted']);
export type PriceStatus = z.infer<typeof PriceStatusSchema>;

// ---------------------------------------------------------------------------
// Artifact schemas (`02_analysis/analysis.json`). Built in code from the
// model outputs below; never sent to the model.
// ---------------------------------------------------------------------------

export const FactSchema = z.object({
  /** Stable id assigned in code, e.g. `F-SITE-01`, `F-IG-02`, `F-P1-01`, `F-NA-01`. */
  id: z.string().min(1),
  statement: z.string().min(1),
  status: FactStatusSchema,
  /** URL or screenshot file name. Required in practice for `verified`. */
  source: z.string().nullable(),
  /** Short literal quote or concrete observation backing the statement. */
  evidence: z.string().nullable(),
  /** ISO timestamp of when the source was read. */
  retrievedAt: z.string().nullable(),
});
export type Fact = z.infer<typeof FactSchema>;

export const PriceSchema = z.object({
  amount: z.number().positive().nullable(),
  currency: z.string().nullable(),
  status: PriceStatusSchema,
  retrievedAt: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  /** Set for `confirmed_by_user` (ADR-018: who/when). */
  confirmedBy: z.literal('user').nullable(),
  confirmedAt: z.string().nullable(),
  /** Price as displayed on the page (variant/promo context) or why it is pending/omitted. */
  note: z.string().nullable(),
});
export type Price = z.infer<typeof PriceSchema>;

export const ProductFactSchema = z.object({
  /** Canonical name — the product name from the brief. */
  name: z.string().min(1),
  url: z.string().nullable(),
  price: PriceSchema,
  /** Only claims printed literally on the official product page. */
  claims: z.array(FactSchema),
});
export type ProductFact = z.infer<typeof ProductFactSchema>;

export const VisualStyleSchema = z.object({
  colorsHex: z.array(z.string().regex(HEX_COLOR)),
  typography: z.string(),
  layoutPatterns: z.array(z.string()),
  photoStyle: z.string(),
});

export const CaptionStyleSchema = z.object({
  length: z.string(),
  emojis: z.string(),
  hashtags: z.string(),
  ctaPatterns: z.array(z.string()),
  language: z.string(),
});

export const SourceRefSchema = z.object({
  source: z.string().min(1),
  title: z.string().nullable(),
  kind: z.enum(['web', 'screenshot']),
});

export const UnavailableSourceSchema = z.object({ source: z.string().min(1), reason: z.string().min(1) });

export const BrandAnalysisSchema = z.object({
  brandName: z.string(),
  analyzedAt: z.string(),
  /** `screenshots` when Instagram was analysed from human-provided screenshots (ADR-005). */
  instagramAccess: z.enum(['screenshots', 'unavailable']),
  tone: z.string(),
  audience: z.string(),
  contentPillars: z.array(z.string()),
  visualStyle: VisualStyleSchema,
  productPresentation: z.string(),
  peoplePresentation: z.string(),
  captionStyle: CaptionStyleSchema,
  brandFacts: z.array(FactSchema),
  products: z.array(ProductFactSchema),
  sourcesUsed: z.array(SourceRefSchema),
  sourcesUnavailable: z.array(UnavailableSourceSchema),
});
export type BrandAnalysis = z.infer<typeof BrandAnalysisSchema>;

export const PriceConfirmationSchema = z.object({
  questionId: z.string(),
  product: z.string(),
  url: z.string().nullable(),
  reason: z.string(),
  suggestedAnswer: z.string().nullable(),
  answer: z.string().nullable(),
  status: z.enum(['confirmed_by_user', 'omitted']),
  confirmedBy: z.literal('user').nullable(),
  answeredAt: z.string(),
});
export type PriceConfirmation = z.infer<typeof PriceConfirmationSchema>;

// ---------------------------------------------------------------------------
// Model-facing schemas (OpenAI structured outputs, strict mode): every field
// required, optional values are `.nullable()`, no formats/patterns/min/max.
// ---------------------------------------------------------------------------

const ModelFactSchema = z.object({
  statement: z.string().describe('One concrete, checkable statement in English.'),
  status: FactStatusSchema.describe(
    'verified = read on an official source you cite; assumption = inferred/not confirmed; unavailable = could not be accessed.',
  ),
  source: z.string().nullable().describe('Exact URL (or screenshot file name) the statement comes from.'),
  evidence: z.string().nullable().describe('Short literal quote or concrete observation from the source.'),
});
export type ModelFact = z.infer<typeof ModelFactSchema>;

const ModelUnavailableSchema = z.object({
  source: z.string().describe('URL or file name that could not be used.'),
  reason: z.string(),
});

/** Output of the `analysis.site` call (web_search over the brand domains). */
export const SiteAnalysisModelSchema = z.object({
  brandFacts: z.array(ModelFactSchema).describe('Facts about the brand/shop (assortment, delivery, positioning, etc.).'),
  products: z.array(
    z.object({
      briefProductName: z.string().describe('Product name exactly as given in the brief.'),
      pageTitle: z.string().nullable().describe('Product name as shown on the official product page.'),
      url: z.string().nullable().describe('Official product page URL, or null if not found.'),
      price: z.object({
        amount: z.number().nullable().describe('Current price as a number, e.g. 24.9. Null if not found.'),
        currency: z.string().nullable().describe('ISO code, e.g. EUR.'),
        priceText: z.string().nullable().describe('Price exactly as displayed, incl. variant/size and promo context.'),
        sourceUrl: z.string().nullable().describe('URL the price was read from.'),
        confident: z
          .boolean()
          .describe('true only if the price was read directly on the official page and is unambiguous.'),
        uncertaintyNote: z.string().nullable().describe('Why the price is uncertain (variants, promo vs regular, not found).'),
      }),
      claims: z.array(ModelFactSchema).describe('Claims printed literally on the official product page.'),
    }),
  ),
  toneSignals: z.string().nullable().describe('How the brand speaks on its website (for context only).'),
  audienceSignals: z.string().nullable().describe('Who the site appears to target (for context only).'),
  sourcesUnavailable: z.array(ModelUnavailableSchema),
});
export type SiteAnalysisModel = z.infer<typeof SiteAnalysisModelSchema>;

/** Output of the `analysis.instagram` call (vision over screenshots). */
export const InstagramAnalysisModelSchema = z.object({
  tone: z.string(),
  audience: z.string(),
  contentPillars: z.array(z.string()),
  visualStyle: z.object({
    colorsHex: z.array(z.string()).describe('Dominant brand colours as uppercase HEX, e.g. #FF6A00.'),
    typography: z.string(),
    layoutPatterns: z.array(z.string()),
    photoStyle: z.string(),
  }),
  productPresentation: z.string(),
  peoplePresentation: z.string(),
  captionStyle: z.object({
    length: z.string(),
    emojis: z.string(),
    hashtags: z.string(),
    ctaPatterns: z.array(z.string()),
    language: z.string(),
  }),
  observations: z
    .array(ModelFactSchema)
    .describe('Concrete observations backing the conclusions; source = screenshot file name.'),
  screenshotsUnreadable: z.array(ModelUnavailableSchema),
});
export type InstagramAnalysisModel = z.infer<typeof InstagramAnalysisModelSchema>;
