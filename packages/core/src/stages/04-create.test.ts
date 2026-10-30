import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../config.js';
import { instagramFixture, planFixture, siteFixture, siteFixtureSources } from '../fixtures/index.js';
import type { ContentPlanModel } from '../schemas/plan.js';
import { checkBrandKit, parseBriefYaml } from './01-brief.js';
import { mergeAnalysis } from './02-analysis.js';
import { validatePlan } from './03-plan.js';
import { buildInstagramText, createStage, type CaptionRecord, type ImagePromptRecord } from './04-create.js';
import { fakeAi, makeContext, tempDir } from './test-helpers.js';

const { brief } = parseBriefYaml(readFileSync(path.join(findRepoRoot(), 'brief.example.yaml'), 'utf8'));

/** A run whose stages 01–03 are done, with a brand kit containing one product photo and a logo. */
async function preparedContext() {
  const brandKitDir = tempDir('kit');
  const kit = path.join(brandKitDir, brief.brand.slug);
  mkdirSync(path.join(kit, 'products'), { recursive: true });
  const white = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } });
  writeFileSync(path.join(kit, 'logo.png'), await white(300, 100).png().toBuffer());
  const firstWithImage = brief.products.find((p) => p.imageFile)!;
  writeFileSync(
    path.join(kit, 'products', firstWithImage.imageFile!),
    await white(400, 500).composite([{ input: await sharp({ create: { width: 200, height: 300, channels: 3, background: '#111' } }).png().toBuffer(), left: 100, top: 100 }]).png().toBuffer(),
  );

  const ai = fakeAi({});
  const ctx = makeContext({ ai, brandKitDir });
  ctx.store.writeJson('brief', 'brief.json', { ...brief, brandKit: checkBrandKit(brandKitDir, brief), warnings: [] });
  const analysis = mergeAnalysis({ brief, site: siteFixture, siteSources: siteFixtureSources, instagram: instagramFixture, screenshots: ['01.png', '02.png'], now: '2026-10-30T12:00:00.000Z' });
  ctx.store.writeJson('analysis', 'analysis.json', analysis);
  const { plan } = validatePlan(structuredClone(planFixture) as ContentPlanModel, analysis);
  ctx.store.writeJson('plan', 'plan.json', plan);
  return { ctx, plan };
}

describe('createStage', () => {
  it('composes every slide of the 3 posts at the right canvas size and writes captions and prompts', async () => {
    const { ctx, plan } = await preparedContext();
    await createStage.run(ctx);

    const slideCount = plan.posts.reduce((n, p) => n + p.slides.length, 0);
    const prompts = ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json');
    expect(prompts).toHaveLength(slideCount);
    expect(prompts.every((p) => p.prompt.includes('no text') || p.prompt.includes('No products') || p.prompt.includes('Absolutely no products'))).toBe(true);

    for (const post of plan.posts) {
      for (const slide of post.slides) {
        const meta = await sharp(ctx.store.path('create', `post_${post.number}/slide_${slide.index}.png`)).metadata();
        expect(meta).toMatchObject(post.format === 'story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 });
      }
    }

    const captions = ctx.store.readJson<CaptionRecord[]>('create', 'captions.json');
    expect(captions.map((c) => c.post)).toEqual([1, 2, 3]);
    expect(ctx.store.exists('create', 'POSTS.md')).toBe(true);
    expect(ctx.store.exists('create', 'post_1/caption.txt')).toBe(true);
  });

  it('reuses unchanged backgrounds on a re-run instead of generating them again', async () => {
    const { ctx } = await preparedContext();
    await createStage.run(ctx);
    await createStage.run(ctx);
    const prompts = ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json');
    expect(prompts.every((p) => p.reused)).toBe(true);
    expect(ctx.logs.some((l) => l.includes('reused'))).toBe(true);
  });

  it('warns and uses a placeholder for products without a photo', async () => {
    const { ctx } = await preparedContext();
    await createStage.run(ctx);
    const specs = ctx.store.readJson<{ productImage: boolean; placed: { element: string }[] }[]>('create', 'compose_specs.json');
    const placeholders = specs.filter((s) => s.placed.some((p) => p.element === 'product-placeholder'));
    if (placeholders.length) expect(ctx.logs.some((l) => l.includes('no product photo'))).toBe(true);
    expect(specs.every((s) => !s.placed.some((p) => p.element === 'product') || s.productImage)).toBe(true);
  });
});

describe('buildInstagramText', () => {
  it('appends CTA and hashtags once', () => {
    expect(buildInstagramText({ captionHr: 'Tekst.', cta: 'Spremi objavu', hashtags: ['gymbeam', '#fitness'] })).toBe(
      'Tekst.\n\nSpremi objavu\n\n#gymbeam #fitness',
    );
    expect(buildInstagramText({ captionHr: 'Tekst. Spremi objavu', cta: 'Spremi objavu', hashtags: [] })).toBe('Tekst. Spremi objavu');
  });
});
