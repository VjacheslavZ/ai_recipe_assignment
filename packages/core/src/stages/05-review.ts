import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { StageContext, StageDefinition } from '../pipeline/types.js';
import { REVIEW_PROMPT_VERSION, buildBackgroundPrompt, buildCaptionReviewPrompt, buildSlideReviewPrompt, isPriceUsable } from '../prompts/index.js';
import { BrandAnalysisSchema, type BrandAnalysis } from '../schemas/analysis.js';
import { BriefArtifactSchema, type BriefArtifact } from '../schemas/brief.js';
import { ContentPlanSchema } from '../schemas/plan.js';
import {
  CRITERIA,
  CaptionReviewModelSchema,
  SlideReviewModelSchema,
  type CaptionResult,
  type Review,
  type SlideAttempt,
  type SlideResult,
  type SlideReviewModel,
} from '../schemas/review.js';
import { composeJob, loadBrandAssets, paintBackground, postDir, sceneInputFor, type BrandAssets, type CaptionRecord, type ComposeSpec, type ImagePromptRecord, type SlideJob } from './04-create.js';
import { renderPostsMd, renderReviewMd } from './markdown.js';

/** Mean of the five 1–5 criterion scores mapped to 0–10, so it compares with QA_SCORE_THRESHOLD. */
export function slideScore(m: SlideReviewModel): Pick<SlideAttempt, 'score' | 'scores'> {
  const scores = Object.fromEntries(
    CRITERIA.map((c) => [c, { score: Math.min(5, Math.max(1, Math.round(m[c].score))), reason: m[c].reason }]),
  );
  const mean = CRITERIA.reduce((sum, c) => sum + scores[c]!.score, 0) / CRITERIA.length;
  return { score: Math.round(((mean - 1) / 4) * 100) / 10, scores };
}

// Amount before or after the currency: "€29.90", "29.90 EUR", "29,90 €".
const PRICE_RE = /(?:€\s?(\d{1,4}(?:[.,]\d{1,2})?))|(?:(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euro|kn\b))/gi;

/** Code-level caption check, independent of the model: every price in the text must be a usable price. */
export function checkCaptionPrices(text: string, analysis: BrandAnalysis): string[] {
  const usable = analysis.products
    .filter((p) => isPriceUsable(p.price.status) && p.price.amount !== null)
    .map((p) => p.price.amount!);
  const issues: string[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const amount = Number((m[1] ?? m[2])!.replace(',', '.'));
    if (!usable.some((u) => Math.abs(u - amount) < 0.005)) {
      issues.push(`price "${m[0]}" is not a verified or user-confirmed price`);
    }
  }
  return issues;
}

function productReference(kitDir: string, brief: BriefArtifact, productName: string | null, assets: BrandAssets): string | null {
  if (!productName || !assets.products.get(productName)) return null;
  const file = brief.products.find((p) => p.name === productName)?.imageFile;
  return file ? path.join(kitDir, 'products', file) : null;
}

async function reviewSlide(
  ctx: StageContext,
  job: SlideJob,
  analysis: BrandAnalysis,
  slidePath: string,
  reference: string | null,
  attempt: number,
) {
  const prompt = buildSlideReviewPrompt({ analysis, post: job.post, slide: job.slide, hasProductReference: Boolean(reference) });
  const res = await ctx.ai.structured({
    purpose: `review.slide.p${job.post.number}s${job.slide.index}${attempt ? `.r${attempt}` : ''}`,
    schema: SlideReviewModelSchema,
    schemaName: 'slide_review',
    ...prompt,
    images: reference ? [slidePath, reference] : [slidePath],
    model: 'vision',
  });
  return res.data;
}

/** The QA feedback appended to the original background prompt for one regeneration. */
export function revisionPrompt(original: string, review: SlideReviewModel): string {
  const fix = review.backgroundFix ?? review.issues.join('; ');
  return `${original}\nRevision requested by QA review: ${fix || 'make the area behind the text calmer and darker for better contrast'}.`;
}

export const reviewStage: StageDefinition = {
  no: 5,
  id: 'review',
  title: 'Review & package',
  async run(ctx) {
    const brief = ctx.store.readJson('brief', 'brief.json', BriefArtifactSchema);
    const analysis = ctx.store.readJson('analysis', 'analysis.json', BrandAnalysisSchema);
    const plan = ctx.store.readJson('plan', 'plan.json', ContentPlanSchema);
    const captions = ctx.store.readJson<CaptionRecord[]>('create', 'captions.json');
    const prompts = new Map(ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json').map((r) => [`${r.post}/${r.slide}`, r]));
    const specs = ctx.store.readJson<ComposeSpec[]>('create', 'compose_specs.json');
    const assets = loadBrandAssets(ctx.kitDir, brief);
    const threshold = ctx.config.QA_SCORE_THRESHOLD;
    const maxRegen = ctx.config.MAX_REGENERATIONS;
    ctx.store.writeJson('review', 'prompts.json', { version: REVIEW_PROMPT_VERSION, note: 'Per-slide and per-caption prompts are built by prompts/review.ts from plan.json and analysis.json.' });

    const slides: SlideResult[] = [];
    const chosenPng = new Map<string, Buffer>();
    for (const post of plan.posts) {
      for (const slide of post.slides) {
        const job = { post, slide };
        const key = `${post.number}/${slide.index}`;
        const reference = productReference(ctx.kitDir, brief, slide.productName, assets);
        const firstFile = `${postDir(post.number)}/slide_${slide.index}.png`;
        const attempts: SlideAttempt[] = [];
        const pngs: Buffer[] = [];

        let review = await reviewSlide(ctx, job, analysis, ctx.store.path('create', firstFile), reference, 0);
        attempts.push({ attempt: 0, file: `04_create/${firstFile}`, backgroundFile: `04_create/${postDir(post.number)}/bg_${slide.index}.png`, ...slideScore(review), issues: review.issues, backgroundFix: review.backgroundFix });
        pngs.push(readFileSync(ctx.store.path('create', firstFile)));

        while (attempts.at(-1)!.score < threshold && attempts.length <= maxRegen) {
          const n = attempts.length;
          const original = prompts.get(key);
          if (!original) break;
          ctx.log(`review: post ${post.number} slide ${slide.index} scored ${attempts.at(-1)!.score} < ${threshold} → regenerating background (attempt ${n})`);
          // Same kind of background as the first attempt: painted around the product again when it was.
          const edit = original.productInScene ? await sceneInputFor(job, assets, 'edit', original.size) : null;
          const plain = edit ? buildBackgroundPrompt({ slide, format: post.format, analysis }) : original.prompt;
          const image = await paintBackground(ctx, {
            purpose: `review.regen.p${post.number}s${slide.index}.r${n}`,
            prompt: revisionPrompt(original.prompt, review),
            plainPrompt: revisionPrompt(plain, review),
            size: original.size,
            quality: original.quality,
            edit,
          });
          const bgFile = `regenerated/${postDir(post.number)}/bg_${slide.index}_r${n}.png`;
          const slideFile = `regenerated/${postDir(post.number)}/slide_${slide.index}_r${n}.png`;
          ctx.store.writeBuffer('review', bgFile, image.png);
          const { png } = await composeJob(job, image.png, analysis, assets, image.productInScene);
          ctx.store.writeBuffer('review', slideFile, png);
          review = await reviewSlide(ctx, job, analysis, ctx.store.path('review', slideFile), reference, n);
          attempts.push({ attempt: n, file: `05_review/${slideFile}`, backgroundFile: `05_review/${bgFile}`, ...slideScore(review), issues: review.issues, backgroundFix: review.backgroundFix });
          pngs.push(png);
        }

        const chosen = attempts.reduce((best, a, i) => (a.score > attempts[best]!.score ? i : best), 0);
        chosenPng.set(key, pngs[chosen]!);
        slides.push({ post: post.number, slide: slide.index, attempts, chosen, passed: attempts[chosen]!.score >= threshold });
      }
    }

    const captionResults: CaptionResult[] = [];
    for (const post of plan.posts) {
      const text = captions.find((c) => c.post === post.number)?.instagramText ?? post.caption;
      const res = await ctx.ai.structured({
        purpose: `review.caption.p${post.number}`,
        schema: CaptionReviewModelSchema,
        schemaName: 'caption_review',
        ...buildCaptionReviewPrompt({ analysis, post, instagramText: text }),
        model: 'text',
      });
      const codeIssues = checkCaptionPrices(text, analysis);
      const passed = res.data.verdict === 'ok' && res.data.claims.every((c) => c.supported) && codeIssues.length === 0;
      captionResults.push({ post: post.number, claims: res.data.claims, languageIssues: res.data.languageIssues, codeIssues, passed });
    }

    const attention: string[] = [];
    for (const s of slides.filter((x) => !x.passed)) attention.push(`post ${s.post} slide ${s.slide}: best QA score ${s.attempts[s.chosen]!.score} is below ${threshold}`);
    for (const c of captionResults.filter((x) => !x.passed)) attention.push(`post ${c.post} caption: needs a fix (see review.md)`);
    for (const s of specs.filter((x) => x.placed.some((p) => p.element === 'product-placeholder'))) attention.push(`post ${s.post} slide ${s.slide}: product photo missing (placeholder shown)`);
    if (!assets.logo) attention.push('logo missing from the brand kit: slides have no logo');
    if (ctx.config.AI_PROVIDER === 'mock') attention.push('run used the mock AI provider: content is placeholder data, not publishable');

    const review: Review = {
      reviewedAt: new Date().toISOString(),
      threshold,
      maxRegenerations: maxRegen,
      slides,
      captions: captionResults,
      passed: slides.every((s) => s.passed) && captionResults.every((c) => c.passed),
      needsHumanAttention: attention,
    };
    ctx.store.writeJson('review', 'review.json', review);
    ctx.store.writeText('review', 'review.md', renderReviewMd(review, plan));

    // Final package: chosen slide versions + captions + POSTS.md, also zipped.
    const zip: Record<string, Uint8Array> = {};
    for (const [key, png] of chosenPng) {
      const [post, slide] = key.split('/');
      const file = `posts/${postDir(Number(post))}/slide_${slide}.png`;
      ctx.store.writeBuffer('review', file, png);
      zip[file] = png;
    }
    for (const c of captions) {
      const file = `posts/${postDir(c.post)}/caption.txt`;
      ctx.store.writeText('review', file, `${c.instagramText}\n`);
      zip[file] = Buffer.from(`${c.instagramText}\n`);
    }
    const postsMd = renderPostsMd(plan, captions.map((c) => ({ ...c, slides: c.slides.map((s) => `posts/${s}`) })));
    ctx.store.writeText('review', 'POSTS.md', postsMd);
    zip['POSTS.md'] = Buffer.from(postsMd);
    zip['review.md'] = Buffer.from(renderReviewMd(review, plan));
    ctx.store.writeBuffer('review', 'posts.zip', Buffer.from(zipSync(zip, { level: 6 })));

    const regenerated = slides.filter((s) => s.attempts.length > 1).length;
    ctx.log(`review: ${slides.filter((s) => s.passed).length}/${slides.length} slide(s) passed, ${regenerated} regenerated; captions ${captionResults.filter((c) => c.passed).length}/${captionResults.length} ok`);
    for (const a of attention) ctx.log(`attention: ${a}`);
  },
};
