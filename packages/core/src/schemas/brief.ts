import { z } from 'zod';

/** Constraints every run carries, whatever the brief says (ADR-017, ADR-018, R24). */
export const DEFAULT_CONSTRAINTS = [
  'No recurring people or influencers; people only as anonymous, non-identifiable background elements.',
  'No invented product properties, prices or quotes; only facts verified on official sources.',
  'Prices only when verified on the official site (URL + date) or confirmed by the user.',
  'Captions in Croatian (hr), natural and on-brand.',
] as const;

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and dashes (it names the brand_kit folder)');

const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

// ---------------------------------------------------------------------------
// Input schema: what a human writes in brief.yaml. Tolerant: snake_case keys,
// optional fields, "TODO" placeholders. Normalised into `Brief` below.
// ---------------------------------------------------------------------------

const productInputSchema = z.object({
  name: z.string().trim().min(1, 'product name is required'),
  url: optionalText,
  imageFile: optionalText,
  notes: optionalText,
});

const referenceInputSchema = z
  .object({ url: optionalText, file: optionalText, note: optionalText })
  .refine((r) => r.url || r.file, 'each reference needs a `url` or a `file`');

export const BriefInputSchema = z.object({
  brand: z.object({
    name: z.string().trim().min(1, 'brand name is required'),
    slug: slugSchema,
    instagramHandle: z.string().trim().min(2, 'instagram handle is required, e.g. @gymbeamhr'),
    instagramUrl: optionalText,
    website: z.string().trim().min(1, 'website is required'),
    shopUrls: z.array(z.string().trim()).nullish(),
    whyThisBrand: z.string().trim().min(1, 'explain briefly why this brand was chosen'),
  }),
  market: z
    .object({
      country: z.literal('HR').default('HR'),
      captionLanguage: z.literal('hr').default('hr'),
    })
    .nullish(),
  products: z.array(productInputSchema).min(1, 'list at least one product to promote'),
  audience: z.string().trim().min(1, 'audience is required'),
  goals: z.array(z.string().trim().min(1)).min(1, 'list at least one goal'),
  references: z.array(referenceInputSchema).nullish(),
  constraints: z.array(z.string().trim().min(1)).nullish(),
  notes: optionalText,
});
export type BriefInput = z.input<typeof BriefInputSchema>;

// ---------------------------------------------------------------------------
// Normalised brief: what the pipeline consumes (`01_brief/brief.json`).
// ---------------------------------------------------------------------------

export const BriefProductSchema = z.object({
  name: z.string().min(1),
  /** Official product page; null when the brief had none or only a TODO placeholder. */
  url: z.url().nullable(),
  /** File name relative to `brand_kit/<slug>/products/`. */
  imageFile: z.string().nullable(),
  notes: z.string().nullable(),
});
export type BriefProduct = z.infer<typeof BriefProductSchema>;

export const BriefSchema = z.object({
  brand: z.object({
    name: z.string().min(1),
    slug: slugSchema,
    instagramHandle: z.string().regex(/^@[A-Za-z0-9._]+$/),
    instagramUrl: z.url(),
    website: z.url(),
    shopUrls: z.array(z.url()),
    whyThisBrand: z.string().min(1),
  }),
  market: z.object({ country: z.literal('HR'), captionLanguage: z.literal('hr') }),
  products: z.array(BriefProductSchema).min(1),
  audience: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  references: z.array(z.object({ url: z.url().nullable(), file: z.string().nullable(), note: z.string().nullable() })),
  constraints: z.array(z.string().min(1)),
  notes: z.string().nullable(),
});
export type Brief = z.infer<typeof BriefSchema>;

/** Result of checking `brand_kit/<slug>/` (stage 01). */
export const BrandKitStatusSchema = z.object({
  dir: z.string(),
  logo: z.string().nullable(),
  products: z.array(z.object({ name: z.string(), imageFile: z.string().nullable(), exists: z.boolean() })),
  instagramScreenshots: z.array(z.string()),
  fonts: z.array(z.string()),
  missing: z.array(z.string()),
});
export type BrandKitStatus = z.infer<typeof BrandKitStatusSchema>;

/** `01_brief/brief.json`: the normalised brief plus brand-kit status and warnings. */
export const BriefArtifactSchema = BriefSchema.extend({
  brandKit: BrandKitStatusSchema,
  warnings: z.array(z.string()),
});
export type BriefArtifact = z.infer<typeof BriefArtifactSchema>;

export class BriefValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid brief:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'BriefValidationError';
  }
}

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Converts snake_case object keys to camelCase recursively, so YAML authors can use either. */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelizeKeys(v)]));
  }
  return value;
}

function asUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : null;
  return withScheme && z.url().safeParse(withScheme).success ? withScheme : null;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}

/**
 * Validates a parsed brief (e.g. from YAML) and normalises it.
 * Throws `BriefValidationError` listing every problem; returns non-fatal warnings
 * (e.g. product URLs still marked TODO) separately.
 */
export function normalizeBrief(raw: unknown): { brief: Brief; warnings: string[] } {
  const parsed = BriefInputSchema.safeParse(camelizeKeys(raw));
  if (!parsed.success) throw new BriefValidationError(formatIssues(parsed.error));
  const input = parsed.data;
  const warnings: string[] = [];
  const issues: string[] = [];

  const website = asUrl(input.brand.website);
  if (!website) issues.push(`brand.website: "${input.brand.website}" is not a valid absolute URL`);

  const handle = input.brand.instagramHandle.startsWith('@')
    ? input.brand.instagramHandle
    : `@${input.brand.instagramHandle}`;
  const instagramUrl = asUrl(input.brand.instagramUrl) ?? `https://www.instagram.com/${handle.slice(1)}/`;

  const shopUrls: string[] = [];
  for (const s of input.brand.shopUrls ?? []) {
    const u = asUrl(s);
    if (u) shopUrls.push(u);
    else warnings.push(`brand.shopUrls: ignored "${s}" (not a valid URL)`);
  }

  const products = input.products.map((p, i) => {
    const url = asUrl(p.url);
    if (!url) {
      warnings.push(
        `products[${i}] "${p.name}": no valid product page URL${p.url ? ` ("${p.url}")` : ''}; stage 02 will search the official site`,
      );
    }
    return { name: p.name, url, imageFile: p.imageFile, notes: p.notes };
  });

  const references = (input.references ?? []).map((r) => {
    const url = asUrl(r.url);
    if (r.url && !url) warnings.push(`references: "${r.url}" is not a valid URL; kept as a note`);
    return { url, file: r.file, note: url || !r.url ? r.note : [r.note, r.url].filter(Boolean).join(' — ') };
  });

  if (issues.length) throw new BriefValidationError(issues);

  const constraints = [...DEFAULT_CONSTRAINTS, ...(input.constraints ?? [])].filter(
    (c, i, all) => all.indexOf(c) === i,
  );

  const brief = BriefSchema.parse({
    brand: {
      name: input.brand.name,
      slug: input.brand.slug,
      instagramHandle: handle,
      instagramUrl,
      website,
      shopUrls,
      whyThisBrand: input.brand.whyThisBrand,
    },
    market: { country: 'HR', captionLanguage: 'hr' },
    products,
    audience: input.audience,
    goals: input.goals,
    references,
    constraints,
    notes: input.notes,
  });
  return { brief, warnings };
}

/** Hostnames (without `www.`) of the brand website and shops — the allowed research domains. */
export function brandDomains(brief: Pick<Brief, 'brand'>): string[] {
  const hosts = [brief.brand.website, ...brief.brand.shopUrls].map((u) =>
    new URL(u).hostname.toLowerCase().replace(/^www\./, ''),
  );
  return [...new Set(hosts)];
}
