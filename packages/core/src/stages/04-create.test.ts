import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildInstagramText, createStage, type CaptionRecord, type ImagePromptRecord } from './04-create.js';
import { fakeAi, prepareRunThroughPlan } from './test-helpers.js';

const preparedContext = () => prepareRunThroughPlan(fakeAi({}));

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
    expect(buildInstagramText({ caption: 'Tekst.', cta: 'Spremi objavu', hashtags: ['gymbeam', '#fitness'] })).toBe(
      'Tekst.\n\nSpremi objavu\n\n#gymbeam #fitness',
    );
    expect(buildInstagramText({ caption: 'Tekst. Spremi objavu', cta: 'Spremi objavu', hashtags: [] })).toBe('Tekst. Spremi objavu');
  });
});
