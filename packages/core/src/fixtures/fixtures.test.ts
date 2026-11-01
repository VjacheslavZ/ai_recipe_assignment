import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../config.js';
import { BrandAnalysisSchema, InstagramAnalysisModelSchema, SiteAnalysisModelSchema } from '../schemas/analysis.js';
import { ContentPlanModelSchema, ContentPlanSchema } from '../schemas/plan.js';
import { analysisStage, briefStage, planStage, stages } from '../stages/index.js';
import { fakeAi, makeContext, tempDir } from '../stages/test-helpers.js';
import { FIXTURE_BRIEF, mockFixtures } from './index.js';

describe('mockFixtures', () => {
  it('pass the model-facing schemas', () => {
    const { __sources, ...site } = mockFixtures['analysis.site'] as Record<string, unknown>;
    expect(Array.isArray(__sources)).toBe(true);
    expect(SiteAnalysisModelSchema.safeParse(site).success).toBe(true);
    expect(InstagramAnalysisModelSchema.safeParse(mockFixtures['analysis.instagram']).success).toBe(true);
    expect(ContentPlanModelSchema.safeParse(mockFixtures.plan).success).toBe(true);
  });

  it('are clearly marked as mock data', () => {
    const text = JSON.stringify(mockFixtures['analysis.site']);
    const statements = [...text.matchAll(/"statement":"([^"]*)"/g)].map((m) => m[1]!);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((s) => s.startsWith('[MOCK]'))).toBe(true);
  });
});

describe('stages 01–03 end to end with fixtures', () => {
  it('runs brief → analysis → plan and writes valid artifacts', async () => {
    const kitDir = tempDir('kit');
    const igDir = path.join(kitDir, 'instagram');
    mkdirSync(igDir, { recursive: true });
    writeFileSync(path.join(igDir, '01.png'), '');
    writeFileSync(path.join(igDir, '02.png'), '');

    const ai = fakeAi(mockFixtures);
    const ctx = makeContext({ ai, kitDir, ask: async (q) => (q.id.includes('creatine') ? '19.90' : null) });
    copyFileSync(path.join(findRepoRoot(), FIXTURE_BRIEF), ctx.store.path('brief', 'brief.input.yaml'));

    expect(stages.map((s) => [s.no, s.id])).toEqual([[1, 'brief'], [2, 'analysis'], [3, 'plan'], [4, 'create'], [5, 'review']]);
    await briefStage.run(ctx);
    await analysisStage.run(ctx);
    await planStage.run(ctx);

    expect(ai.requests.map((r) => r.purpose)).toEqual(['analysis.site', 'analysis.instagram', 'plan']);
    expect(ai.requests[0]!.webSearch).toEqual({ allowedDomains: ['gymbeam.hr'], country: 'HR' });
    expect(ai.requests[1]!.images).toEqual([path.join(igDir, '01.png'), path.join(igDir, '02.png')]);
    expect(ai.requests[1]!.model).toBe('vision');

    const analysis = ctx.store.readJson('analysis', 'analysis.json', BrandAnalysisSchema);
    expect(analysis.products.map((p) => p.price.status)).toEqual(['verified', 'confirmed_by_user', 'omitted']);
    expect(ctx.questions.map((q) => q.id)).toEqual(['price:gymbeam-creatine-monohydrate', 'price:gymbeam-protein-bar']);
    for (const f of ['analysis.md', 'sources.json', 'price_confirmations.json', 'prompts.json']) {
      expect(ctx.store.exists('analysis', f)).toBe(true);
    }
    const md = readFileSync(ctx.store.path('analysis', 'analysis.md'), 'utf8');
    expect(md).toMatch(/## Verified/);
    expect(md).toMatch(/## Assumptions/);
    expect(md).toMatch(/## Unavailable/);

    const plan = ctx.store.readJson('plan', 'plan.json', ContentPlanSchema);
    expect(plan.posts).toHaveLength(3);
    expect(readFileSync(ctx.store.path('plan', 'plan.md'), 'utf8')).toMatch(/## Post 1 — carousel · education/);
  });
});
