import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AiClient } from '../ai/types.js';
import { captionReviewFixture, slideReviewFixture } from '../fixtures/index.js';
import type { BrandAnalysis } from '../schemas/analysis.js';
import { ReviewSchema, type SlideReviewModel } from '../schemas/review.js';
import { createStage } from './04-create.js';
import { checkCaptionPrices, reviewStage, revisionPrompt, slideScore } from './05-review.js';
import { fakeAi, prepareRunThroughPlan } from './test-helpers.js';

const bad: SlideReviewModel = {
  ...slideReviewFixture,
  readability: { score: 1, reason: 'White text over a bright, busy area.' },
  brandFit: { score: 2, reason: 'Off-brand colours.' },
  issues: ['low contrast headline'],
  backgroundFix: 'darker, calmer upper half',
};

/** Review fixtures by purpose prefix; `badSlides` score low on their first attempt only. */
function qaAi(badSlides: string[] = []): AiClient & { purposes: string[] } {
  const base = fakeAi({});
  const purposes: string[] = [];
  return {
    purposes,
    generateImage: (req) => {
      purposes.push(req.purpose);
      return base.generateImage(req);
    },
    async structured(req) {
      purposes.push(req.purpose);
      const m = /^review\.slide\.(p\d+s\d+)(\.r\d+)?$/.exec(req.purpose);
      const data = m ? (badSlides.includes(m[1]!) && !m[2] ? bad : slideReviewFixture) : captionReviewFixture;
      return { data: req.schema.parse(data), sources: [], call: { id: 't', purpose: req.purpose, provider: 'mock', model: 'fake', kind: 'vision', inputTokens: 0, outputTokens: 0, imageCount: 0, webSearchCalls: 0, costUsd: 0, durationMs: 0, status: 'ok', retryCount: 0, startedAt: '' } };
    },
  };
}

async function runThroughCreate(ai: AiClient) {
  const prepared = await prepareRunThroughPlan(ai);
  await createStage.run(prepared.ctx);
  return prepared;
}

describe('slideScore', () => {
  it('maps the mean of five 1–5 scores to 0–10 and clamps out-of-range values', () => {
    expect(slideScore(slideReviewFixture).score).toBe(10);
    const allOnes = { ...slideReviewFixture, brandFit: { score: 0, reason: '' }, readability: { score: 1, reason: '' }, productAccuracy: { score: 1, reason: '' }, goalFit: { score: 1, reason: '' }, textCorrectness: { score: 1, reason: '' } };
    expect(slideScore(allOnes).score).toBe(0);
    expect(slideScore(bad).score).toBe(6.5);
  });
});

describe('checkCaptionPrices', () => {
  const analysis = { products: [{ name: 'X', url: null, claims: [], price: { amount: 29.9, currency: 'EUR', status: 'verified', retrievedAt: null, sourceUrl: null, confirmedBy: null, confirmedAt: null, note: null } }] } as unknown as BrandAnalysis;
  it('accepts usable prices and flags any other price', () => {
    expect(checkCaptionPrices('Only €29.90 today!', analysis)).toEqual([]);
    expect(checkCaptionPrices('Only €19.90 today!', analysis)).toHaveLength(1);
    expect(checkCaptionPrices('Now 29,90 € and 19.90 EUR', analysis)).toHaveLength(1);
    expect(checkCaptionPrices('No price here.', analysis)).toEqual([]);
  });
});

describe('revisionPrompt', () => {
  it('appends the QA background fix to the original prompt', () => {
    expect(revisionPrompt('Scene: gym', bad)).toBe('Scene: gym\nRevision requested by QA review: darker, calmer upper half.');
  });
});

describe('reviewStage', () => {
  it('scores every slide, checks every caption and packages the posts', async () => {
    const { ctx, plan } = await runThroughCreate(qaAi());
    await reviewStage.run(ctx);

    const review = ctx.store.readJson('review', 'review.json', ReviewSchema);
    const slideCount = plan.posts.reduce((n, p) => n + p.slides.length, 0);
    expect(review.slides).toHaveLength(slideCount);
    expect(review.slides.every((s) => s.passed && s.attempts.length === 1)).toBe(true);
    expect(review.captions.map((c) => c.post)).toEqual([1, 2, 3]);

    const zip = unzipSync(readFileSync(ctx.store.path('review', 'posts.zip')));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['POSTS.md', 'review.md', 'posts/post_1/slide_1.png', 'posts/post_1/caption.txt']));
    expect(Object.keys(zip).filter((f) => f.endsWith('.png'))).toHaveLength(slideCount);
  });

  it('catches a bad slide, regenerates its background once with the QA fix and ships the better version', async () => {
    const ai = qaAi(['p1s1']);
    const { ctx } = await runThroughCreate(ai);
    await reviewStage.run(ctx);

    const review = ctx.store.readJson('review', 'review.json', ReviewSchema);
    const s = review.slides.find((x) => x.post === 1 && x.slide === 1)!;
    expect(s.attempts.map((a) => a.score)).toEqual([6.5, 10]);
    expect(s.chosen).toBe(1);
    expect(s.passed).toBe(true);
    expect(ai.purposes).toContain('review.regen.p1s1.r1');
    expect(ctx.store.exists('review', 'regenerated/post_1/slide_1_r1.png')).toBe(true);
    // Only the failing slide was regenerated.
    expect(review.slides.filter((x) => x.attempts.length > 1)).toHaveLength(1);
  });

  it('keeps the best attempt and flags the slide when it never reaches the threshold', async () => {
    const { ctx } = await runThroughCreate(qaAi(['p2s1']));
    ctx.config.MAX_REGENERATIONS = 0;
    await reviewStage.run(ctx);
    const review = ctx.store.readJson('review', 'review.json', ReviewSchema);
    const s = review.slides.find((x) => x.post === 2)!;
    expect(s.passed).toBe(false);
    expect(review.passed).toBe(false);
    expect(review.needsHumanAttention.some((a) => a.startsWith('post 2 slide 1'))).toBe(true);
  });
});
