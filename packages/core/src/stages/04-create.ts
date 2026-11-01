import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canvasFor, composeSlide, formatPrice, productChange, productSceneInput, type ComposeResult } from '../compose/compose.js';
import type { StageContext, StageDefinition } from '../pipeline/types.js';
import { BACKGROUND_PROMPT_VERSION, buildBackgroundPrompt, isPriceUsable } from '../prompts/index.js';
import { BrandAnalysisSchema, type BrandAnalysis } from '../schemas/analysis.js';
import { BriefArtifactSchema, type BriefArtifact } from '../schemas/brief.js';
import { ContentPlanSchema, type PostPlan, type SlidePlan } from '../schemas/plan.js';
import { renderPostsMd } from './markdown.js';

/** Fallback face when the brand kit has no licensed font (fontconfig name). */
export const DEFAULT_FONT = 'sans bold';
/** Background generations in flight at once: fast enough, gentle on rate limits. */
const IMAGE_CONCURRENCY = 2;

export interface ImagePromptRecord {
  post: number;
  slide: number;
  file: string;
  version: string;
  model: string;
  size: string;
  quality: string;
  prompt: string;
  promptHash: string;
  /** true when an existing background with the same prompt/settings was reused (no new AI call). */
  reused: boolean;
  /** Painted around the real product with an image edit (BACKGROUND_MODE=edit); compose then crops from the centre and adds no shadow. */
  productInScene: boolean;
  /** Edit mode: how much the model changed the product (see productChange); above the limit the edit was replaced by a plain background. */
  productChange?: number;
}

/** Above this the model redrew the product instead of keeping it (calibrated: kept ≈ 14, redrawn ≈ 94). */
export const PRODUCT_CHANGE_LIMIT = 40;

/**
 * Paints a background around the real product; when the model redraws the product instead of
 * keeping it, falls back to an empty scene (the product is then composited with a drop shadow).
 */
export async function paintBackground(
  ctx: StageContext,
  req: { purpose: string; prompt: string; plainPrompt: string; size: string; quality: string; edit: { image: Buffer; mask: Buffer } | null },
): Promise<{ png: Buffer; productInScene: boolean; productChange?: number }> {
  const { purpose, size, quality, edit } = req;
  if (!edit) return { png: (await ctx.ai.generateImage({ purpose, prompt: req.plainPrompt, size, quality })).png, productInScene: false };
  const res = await ctx.ai.generateImage({ purpose, prompt: req.prompt, size, quality, edit });
  const change = Math.round(await productChange(edit, res.png));
  if (change <= PRODUCT_CHANGE_LIMIT) return { png: res.png, productInScene: true, productChange: change };
  ctx.log(`warning: ${purpose}: the image model redrew the product (change ${change} > ${PRODUCT_CHANGE_LIMIT}) — generating an empty scene instead`);
  const plain = await ctx.ai.generateImage({ purpose: `${purpose}.plain`, prompt: req.plainPrompt, size, quality });
  return { png: plain.png, productInScene: false, productChange: change };
}

export interface CaptionRecord {
  post: number;
  format: PostPlan['format'];
  goal: PostPlan['goal'];
  slides: string[];
  caption: string;
  hashtags: string[];
  cta: string;
  /** Ready to paste into Instagram: caption + CTA + hashtags. */
  instagramText: string;
}

export const postDir = (n: number) => `post_${n}`;

export function hashOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export function buildInstagramText(post: Pick<PostPlan, 'caption' | 'cta' | 'hashtags'>): string {
  const tags = post.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const caption = post.caption.trim();
  // The planner often already ends the caption with the CTA; don't repeat it.
  const withCta = caption.includes(post.cta.trim()) ? caption : `${caption}\n\n${post.cta.trim()}`;
  return tags && !withCta.includes(tags) ? `${withCta}\n\n${tags}` : withCta;
}

function priceLabel(slide: SlidePlan, analysis: BrandAnalysis): string | null {
  if (!slide.showPrice || !slide.productName) return null;
  const product = analysis.products.find((p) => p.name === slide.productName);
  if (!product || !isPriceUsable(product.price.status) || product.price.amount === null) return null;
  return formatPrice(product.price.amount, product.price.currency);
}

function readOptional(file: string | null): Buffer | null {
  return file && existsSync(file) ? readFileSync(file) : null;
}

export interface SlideJob {
  post: PostPlan;
  slide: SlidePlan;
}

/** Real brand assets for compositing: logo and product photos by product name. */
export interface BrandAssets {
  logo: Buffer | null;
  products: Map<string, Buffer | null>;
}

export function loadBrandAssets(kitDir: string, brief: BriefArtifact): BrandAssets {
  return {
    logo: readOptional(path.join(kitDir, 'logo.png')),
    products: new Map(brief.products.map((p) => [p.name, readOptional(p.imageFile ? path.join(kitDir, 'products', p.imageFile) : null)])),
  };
}

export type ComposeSpec = Omit<ComposeResult, 'png'> & { post: number; slide: number; file: string; productImage: boolean; priceLabel: string | null };

/** Composes one slide from a background; shared by stage 04 and the regeneration in stage 05. */
export async function composeJob(
  job: SlideJob,
  background: Buffer,
  analysis: BrandAnalysis,
  assets: BrandAssets,
  productInScene = false,
): Promise<{ png: Buffer; spec: Omit<ComposeSpec, 'file'> }> {
  const { post, slide } = job;
  const product = slide.productName ? (assets.products.get(slide.productName) ?? null) : null;
  const label = priceLabel(slide, analysis);
  const result = await composeSlide({
    canvas: canvasFor(post.format),
    layout: slide.layout,
    background,
    headline: slide.headline,
    subtext: slide.subtext,
    priceLabel: label,
    product,
    productInScene: productInScene && Boolean(product),
    productPlaceholder: slide.productName,
    logo: assets.logo,
    colorsHex: slide.brandColorsHex.length ? slide.brandColorsHex : analysis.visualStyle.colorsHex,
    font: DEFAULT_FONT,
  });
  return {
    png: result.png,
    spec: { post: post.number, slide: slide.index, productImage: Boolean(product), priceLabel: label, layout: result.layout, placed: result.placed },
  };
}

/** Reuses an existing background when prompt, model and settings are unchanged (cheap re-runs of compose). */
function previousPrompts(ctx: StageContext): Map<string, ImagePromptRecord> {
  if (!ctx.store.exists('create', 'image_prompts.json')) return new Map();
  const prev = ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json');
  return new Map(prev.map((r) => [r.file, r]));
}

/**
 * The edit input for a slide whose background is painted around its real product, or null when
 * the slide is generated as an empty scene (no product photo, text-only layout, generate mode).
 */
export async function sceneInputFor(job: SlideJob, assets: BrandAssets, mode: 'edit' | 'generate', size: string) {
  const product = job.slide.productName ? assets.products.get(job.slide.productName) : null;
  if (mode !== 'edit' || !product) return null;
  return productSceneInput(canvasFor(job.post.format), job.slide.layout, product, size);
}

async function backgroundFor(
  ctx: StageContext,
  job: SlideJob,
  analysis: BrandAnalysis,
  assets: BrandAssets,
  prev: Map<string, ImagePromptRecord>,
): Promise<ImagePromptRecord & { png: Buffer }> {
  const { post, slide } = job;
  const file = `${postDir(post.number)}/bg_${slide.index}.png`;
  const model = ctx.config.OPENAI_IMAGE_MODEL;
  const size = ctx.config.IMAGE_SIZE;
  const quality = ctx.config.IMAGE_QUALITY;
  const edit = await sceneInputFor(job, assets, ctx.config.BACKGROUND_MODE, size);
  const plainPrompt = buildBackgroundPrompt({ slide, format: post.format, analysis });
  const prompt = edit ? buildBackgroundPrompt({ slide, format: post.format, analysis, productInScene: slide.productName! }) : plainPrompt;
  // The edit input (product photo and its placement) is part of the hash: a new photo means a new background.
  const promptHash = hashOf(BACKGROUND_PROMPT_VERSION, model, size, quality, prompt, edit ? hashOf(edit.image.toString('base64')) : '');
  const record = { post: post.number, slide: slide.index, file, version: BACKGROUND_PROMPT_VERSION, model, size, quality, prompt, promptHash, productInScene: Boolean(edit) };

  const before = prev.get(file);
  if (before?.promptHash === promptHash && ctx.store.exists('create', file)) {
    // Keep how that background was made (an edit may have fallen back to a plain scene).
    return { ...record, productInScene: before.productInScene, productChange: before.productChange, reused: true, png: readFileSync(ctx.store.path('create', file)) };
  }
  const res = await paintBackground(ctx, { purpose: `create.bg.p${post.number}s${slide.index}`, prompt, plainPrompt, size, quality, edit });
  ctx.store.writeBuffer('create', file, res.png);
  return { ...record, productInScene: res.productInScene, ...(res.productChange !== undefined ? { productChange: res.productChange } : {}), reused: false, png: res.png };
}

export const createStage: StageDefinition = {
  no: 4,
  id: 'create',
  title: 'Create posts',
  async run(ctx) {
    const brief: BriefArtifact = ctx.store.readJson('brief', 'brief.json', BriefArtifactSchema);
    const analysis = ctx.store.readJson('analysis', 'analysis.json', BrandAnalysisSchema);
    const plan = ctx.store.readJson('plan', 'plan.json', ContentPlanSchema);

    const assets = loadBrandAssets(ctx.kitDir, brief);
    if (!assets.logo) ctx.log('warning: no logo.png among the run inputs — slides are composed without a logo');

    const jobs: SlideJob[] = plan.posts.flatMap((post) => post.slides.map((slide) => ({ post, slide })));
    const prev = previousPrompts(ctx);
    ctx.log(`create: ${jobs.length} slide(s) across ${plan.posts.length} posts`);

    const backgrounds = await mapLimit(jobs, IMAGE_CONCURRENCY, (job) => backgroundFor(ctx, job, analysis, assets, prev));
    const reused = backgrounds.filter((b) => b.reused).length;
    if (reused) ctx.log(`create: reused ${reused} unchanged background(s)`);
    const inScene = backgrounds.filter((b) => b.productInScene).length;
    if (inScene) ctx.log(`create: ${inScene} background(s) painted around the real product (image edit)`);
    ctx.store.writeJson('create', 'image_prompts.json', backgrounds.map(({ png: _png, ...r }) => r));

    const specs: ComposeSpec[] = [];
    const missingProducts = new Set<string>();
    for (const [i, job] of jobs.entries()) {
      const { png, spec } = await composeJob(job, backgrounds[i]!.png, analysis, assets, backgrounds[i]!.productInScene);
      if (job.slide.productName && !spec.productImage) missingProducts.add(job.slide.productName);
      const file = `${postDir(job.post.number)}/slide_${job.slide.index}.png`;
      ctx.store.writeBuffer('create', file, png);
      specs.push({ ...spec, file });
    }
    for (const name of missingProducts) ctx.log(`warning: no product photo for "${name}" — a labelled placeholder was used`);
    ctx.store.writeJson('create', 'compose_specs.json', specs);

    const captions: CaptionRecord[] = plan.posts.map((post) => ({
      post: post.number,
      format: post.format,
      goal: post.goal,
      slides: post.slides.map((s) => `${postDir(post.number)}/slide_${s.index}.png`),
      caption: post.caption,
      hashtags: post.hashtags,
      cta: post.cta,
      instagramText: buildInstagramText(post),
    }));
    ctx.store.writeJson('create', 'captions.json', captions);
    for (const c of captions) ctx.store.writeText('create', `${postDir(c.post)}/caption.txt`, `${c.instagramText}\n`);
    ctx.store.writeText('create', 'POSTS.md', renderPostsMd(plan, captions));
    ctx.log(`create: ${specs.length} slide(s) composed → ${ctx.store.stageDir('create')}`);
  },
};
