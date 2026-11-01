import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../config.js';
import { CREATINE, FIXTURE_BRIEF, WHEY, instagramFixture, planFixture, siteFixture, siteFixtureSources } from '../fixtures/index.js';
import type { BrandAnalysis } from '../schemas/analysis.js';
import type { ContentPlanModel } from '../schemas/plan.js';
import { parseBriefYaml } from './01-brief.js';
import { mergeAnalysis } from './02-analysis.js';
import { buildPlanPrompt } from '../prompts/index.js';
import { PlanValidationError, planStage, validatePlan } from './03-plan.js';
import { fakeAi, prepareRunThroughPlan } from './test-helpers.js';

const { brief } = parseBriefYaml(readFileSync(path.join(findRepoRoot(), FIXTURE_BRIEF), 'utf8'));
const analysis: BrandAnalysis = mergeAnalysis({
  brief,
  site: siteFixture,
  siteSources: siteFixtureSources,
  instagram: instagramFixture,
  screenshots: ['01.png', '02.png'],
  now: '2026-10-30T12:00:00.000Z',
});

const plan = (): ContentPlanModel => structuredClone(planFixture) as ContentPlanModel;

function violations(p: ContentPlanModel, a: BrandAnalysis = analysis): string[] {
  try {
    validatePlan(p, a);
  } catch (err) {
    if (err instanceof PlanValidationError) return err.violations;
    throw err;
  }
  return [];
}

describe('validatePlan', () => {
  it('accepts the fixture plan unchanged', () => {
    const { plan: out, fixes } = validatePlan(plan(), analysis);
    expect(fixes).toEqual([]);
    expect(out.posts.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(out.posts.map((p) => p.format)).toEqual(['carousel', 'single', 'story']);
  });

  it('forces showPrice to false when the price is not verified or confirmed', () => {
    const p = plan();
    p.posts[0]!.slides[2]!.showPrice = true; // creatine: pending_confirmation
    const { plan: out, fixes } = validatePlan(p, analysis);
    expect(out.posts[0]!.slides[2]!.showPrice).toBe(false);
    expect(fixes.join('\n')).toMatch(/showPrice forced to false.*pending_confirmation/);

    const confirmed = structuredClone(analysis);
    confirmed.products.find((x) => x.name === CREATINE)!.price.status = 'confirmed_by_user';
    expect(validatePlan(p, confirmed).plan.posts[0]!.slides[2]!.showPrice).toBe(true);

    const omitted = structuredClone(analysis);
    omitted.products.find((x) => x.name === WHEY)!.price.status = 'omitted';
    expect(validatePlan(plan(), omitted).plan.posts[2]!.slides[1]!.showPrice).toBe(false);
  });

  it('removes emoji from slide text and reports it', () => {
    const p = plan();
    p.posts[1]!.slides[0]!.headline = 'Pick your vibe 🍓';
    p.posts[1]!.slides[0]!.subtext = '💗';
    const { plan: out, fixes } = validatePlan(p, analysis);
    expect(out.posts[1]!.slides[0]).toMatchObject({ headline: 'Pick your vibe', subtext: null });
    expect(fixes.some((f) => f.includes('emoji removed'))).toBe(true);
  });

  it('rejects a post without a product slide', () => {
    const p = plan();
    for (const s of p.posts[1]!.slides) {
      s.productName = null;
      s.layout = 'text-only';
    }
    expect(() => validatePlan(p, analysis)).toThrow(/post 2: no slide shows a product/);
  });

  it('rejects unknown products', () => {
    const p = plan();
    p.posts[1]!.slides[0]!.productName = 'GymBeam Magic Pills';
    expect(violations(p).join('\n')).toMatch(/product "GymBeam Magic Pills" is not in the analysis/);
  });

  it('matches product names case-insensitively and canonicalises them', () => {
    const p = plan();
    p.posts[1]!.slides[0]!.productName = WHEY.toUpperCase();
    expect(validatePlan(p, analysis).plan.posts[1]!.slides[0]!.productName).toBe(WHEY);
  });

  it('rejects wrong slide counts per format', () => {
    const p = plan();
    p.posts[0]!.slides = p.posts[0]!.slides.slice(0, 2); // carousel with 2
    p.posts[1]!.slides.push(structuredClone(p.posts[1]!.slides[0]!)); // single with 2
    p.posts[2]!.slides = p.posts[2]!.slides.slice(0, 1); // story with 1
    const v = violations(p).join('\n');
    expect(v).toMatch(/post 1: carousel needs 3–6 slide\(s\), got 2/);
    expect(v).toMatch(/post 2: single needs 1 slide\(s\), got 2/);
    expect(v).toMatch(/post 3: story needs 2–3 slide\(s\), got 1/);
  });

  it('requires exactly three posts numbered 1–3', () => {
    const p = plan();
    p.posts[2]!.number = 2;
    expect(violations(p).join('\n')).toMatch(/exactly 3 posts numbered 1, 2, 3/);
    const q = plan();
    q.posts.pop();
    expect(violations(q).join('\n')).toMatch(/exactly 3 posts/);
  });

  it('only allows existing, verified fact ids', () => {
    const p = plan();
    p.posts[0]!.factIds.push('F-SITE-04'); // assumption
    p.posts[1]!.factIds.push('F-NOPE-99');
    const v = violations(p).join('\n');
    expect(v).toMatch(/factId "F-SITE-04" is "assumption"/);
    expect(v).toMatch(/factId "F-NOPE-99" does not exist/);
  });

  it('fixes slide order, layouts and invalid colours', () => {
    const p = plan();
    p.posts[0]!.slides[0]!.index = 7;
    p.posts[0]!.slides[0]!.brandColorsHex = ['#111111', 'orange'];
    p.posts[1]!.slides[0]!.layout = 'text-only';
    const { plan: out, fixes } = validatePlan(p, analysis);
    expect(out.posts[0]!.slides.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(out.posts[0]!.slides[3]!.role).toBe('hook');
    expect(out.posts[0]!.slides[3]!.brandColorsHex).toEqual(['#111111']);
    expect(out.posts[1]!.slides[0]!.layout).toBe('product-center');
    expect(fixes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('planStage', () => {
  const withAssumption = () => {
    const p = plan();
    p.posts[1]!.factIds.push('F-SITE-04'); // assumption
    return p;
  };

  it('lists assumptions without ids, so the model cannot cite them as facts', () => {
    const { input } = buildPlanPrompt({ brief, analysis });
    const assumption = analysis.brandFacts.find((f) => f.id === 'F-SITE-04')!;
    expect(input).toContain(`- ${assumption.statement}`);
    expect(input).not.toContain('[F-SITE-04]');
  });

  it('sends the violations back once and uses the corrected plan', async () => {
    const ai = fakeAi({ plan: withAssumption(), 'plan.retry': plan() });
    const { ctx } = await prepareRunThroughPlan(ai);
    await planStage.run(ctx);
    expect(ai.requests.map((r) => r.purpose)).toEqual(['plan', 'plan.retry']);
    expect(ai.requests[1]!.input).toMatch(/previous plan was rejected[\s\S]*F-SITE-04/);
    expect(ctx.logs.some((l) => l.startsWith('plan rejected'))).toBe(true);
  });

  it('stops when the corrected plan still breaks the rules', async () => {
    const ai = fakeAi({ plan: withAssumption(), 'plan.retry': withAssumption() });
    const { ctx } = await prepareRunThroughPlan(ai);
    await expect(planStage.run(ctx)).rejects.toBeInstanceOf(PlanValidationError);
    expect(ai.requests).toHaveLength(2);
  });
});
