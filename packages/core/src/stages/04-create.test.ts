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

  it('paints product slides around the real product (image edit) and generates the others', async () => {
    const ai = fakeAi({});
    const { ctx, plan, brief } = await prepareRunThroughPlan(ai);
    await createStage.run(ctx);
    const withPhoto = brief.products.find((p) => p.imageFile)!.name;
    const prompts = ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json');
    for (const post of plan.posts) {
      for (const slide of post.slides) {
        const record = prompts.find((r) => r.post === post.number && r.slide === slide.index)!;
        const request = ai.imageRequests.find((r) => r.purpose === `create.bg.p${post.number}s${slide.index}`)!;
        const expected = slide.productName === withPhoto;
        expect(record.productInScene).toBe(expected);
        expect(Boolean(request.edit)).toBe(expected);
        expect(record.prompt.includes('Keep the product exactly where and as it is')).toBe(expected);
      }
    }
    expect(prompts.some((r) => r.productInScene)).toBe(true);
  });

  it('falls back to an empty scene when the image model redraws the product', async () => {
    const ai = fakeAi({});
    // A "model" that ignores the mask: every edit comes back as one flat colour.
    const generate = ai.generateImage.bind(ai);
    ai.generateImage = (req) => generate({ ...req, edit: undefined });
    const { ctx } = await prepareRunThroughPlan(ai);
    await createStage.run(ctx);
    const prompts = ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json');
    const edited = ai.imageRequests.filter((r) => r.purpose.endsWith('.plain'));
    expect(edited.length).toBeGreaterThan(0);
    expect(prompts.every((r) => !r.productInScene)).toBe(true);
    expect(prompts.some((r) => (r.productChange ?? 0) > 40)).toBe(true);
    expect(ctx.logs.some((l) => l.includes('redrew the product'))).toBe(true);
  });

  it('generates every background as an empty scene with BACKGROUND_MODE=generate', async () => {
    const ai = fakeAi({});
    const { ctx } = await prepareRunThroughPlan(ai);
    ctx.config.BACKGROUND_MODE = 'generate';
    await createStage.run(ctx);
    expect(ai.imageRequests.every((r) => !r.edit)).toBe(true);
    expect(ctx.store.readJson<ImagePromptRecord[]>('create', 'image_prompts.json').every((r) => !r.productInScene)).toBe(true);
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
