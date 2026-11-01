import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stringify as toYaml } from 'yaml';
import type { AiCallRecord, AiClient } from '../ai/types.js';
import { buildBriefIntakePrompt } from '../prompts/brief-intake.js';
import { BriefDraftModelSchema, type BriefDraftModel } from '../schemas/brief-draft.js';
import { BriefValidationError, normalizeBrief, type Brief, type BriefInput } from '../schemas/brief.js';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** A brief prepared from free text, for the person to check before starting a run. */
export interface BriefDraft {
  /** The brief in the YAML format `POST /api/runs` takes; empty fields are left out. */
  yaml: string;
  /** The normalised brief when nothing required is missing and it validates. */
  brief: Brief | null;
  /** Required information the text did not give; the run cannot start without it. */
  missing: string[];
  /** Other validation problems (e.g. a website that is not a URL). */
  issues: string[];
  warnings: string[];
  /** Fields the model proposed itself; shown so the person can correct them. */
  assumptions: BriefDraftModel['assumptions'];
  call: AiCallRecord;
}

export interface DraftBriefOptions {
  text: string;
  /** The run's input folder (`products/` holds the photos the brief may name). */
  kitDir: string;
  /** File names of product photos uploaded with this request. */
  uploadedProductFiles?: string[];
}

/** `@GymBeam.HR` → `gymbeam-hr`: the brand slug (names the run folders). */
export function slugFromHandle(handle: string): string {
  return handle
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function productFilesIn(kitDir: string): string[] {
  const dir = path.join(kitDir, 'products');
  return existsSync(dir) ? readdirSync(dir).filter((f) => IMAGE_EXT.test(f)) : [];
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** `https://www.gymbeam.hr/` → `gymbeam.hr`; the raw string when it is not a URL. */
function host(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Turns the model's draft into brief input; lists what is missing instead of inventing it. */
export function draftToBriefInput(d: BriefDraftModel): { input: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];
  if (blank(d.brand.name)) missing.push('Brand name');
  if (blank(d.brand.instagramHandle)) missing.push('Instagram account (e.g. @gymbeamhr)');
  if (blank(d.brand.website)) missing.push('Official website (the only source of product facts and prices)');
  if (!d.products.length) missing.push('At least one product to promote');
  if (blank(d.audience)) missing.push('Audience');
  if (!d.goals.length) missing.push('Goals for the posts');
  if (blank(d.brand.whyThisBrand)) missing.push('Why this brand');

  const handle = d.brand.instagramHandle?.trim() ?? '';
  const input: BriefInput = {
    title: d.title,
    brand: {
      name: d.brand.name ?? '',
      slug: handle ? slugFromHandle(handle) : '',
      instagramHandle: handle,
      website: d.brand.website ?? '',
      // Models tend to repeat the website as a shop.
      shopUrls: d.brand.shopUrls.filter((u) => !d.brand.website || host(u) !== host(d.brand.website)),
      whyThisBrand: d.brand.whyThisBrand ?? '',
    },
    products: d.products,
    audience: d.audience ?? '',
    goals: d.goals,
    references: d.references,
    constraints: d.constraints,
    notes: d.notes,
  };
  return { input: input as Record<string, unknown>, missing };
}

/** Drops empty values so the YAML shows only what the brief actually says. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** Free text → brief, with one cheap text-model call (purpose `brief.intake`). */
export async function draftBrief(ai: AiClient, opts: DraftBriefOptions): Promise<BriefDraft> {
  const uploaded = opts.uploadedProductFiles ?? [];
  const productFiles = [...new Set([...uploaded, ...productFilesIn(opts.kitDir)])].sort();
  const prompt = buildBriefIntakePrompt({ text: opts.text, productFiles });
  const res = await ai.structured({
    purpose: 'brief.intake',
    schema: BriefDraftModelSchema,
    schemaName: 'brief_draft',
    system: prompt.system,
    input: prompt.input,
    model: 'text',
  });

  // Only file names that exist; a guessed name would silently show a placeholder later.
  const products = res.data.products.map((p) => ({ ...p, imageFile: p.imageFile && productFiles.includes(p.imageFile) ? p.imageFile : null }));
  // Names like prod1.png say nothing about the product. One product without a photo and one
  // unused photo can only belong together; anything more is left to the person (the UI asks).
  const withoutPhoto = products.filter((p) => !p.imageFile);
  const unused = productFiles.filter((f) => !products.some((p) => p.imageFile === f));
  if (withoutPhoto.length === 1 && unused.length === 1) withoutPhoto[0]!.imageFile = unused[0]!;
  const draft: BriefDraftModel = { ...res.data, products };
  const { input, missing } = draftToBriefInput(draft);
  const yaml = `# Prepared from a free-text request; check it before starting the run.\n${toYaml(prune(input), { lineWidth: 0 })}`;

  let brief: Brief | null = null;
  let issues: string[] = [];
  let warnings: string[] = [];
  if (!missing.length) {
    try {
      ({ brief, warnings } = normalizeBrief(input));
      // The card already says a product page will be searched for; stage 01 still logs it.
      warnings = warnings.filter((w) => !w.includes('no valid product page URL'));
    } catch (err) {
      issues = err instanceof BriefValidationError ? err.issues : [(err as Error).message];
    }
  }
  return { yaml, brief, missing, issues, warnings, assumptions: draft.assumptions, call: res.call };
}
