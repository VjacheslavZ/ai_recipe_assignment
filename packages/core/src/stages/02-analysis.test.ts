import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../config.js';
import { BAR, CREATINE, WHEY, instagramFixture, mockFixtures, siteFixture, siteFixtureSources } from '../fixtures/index.js';
import { BrandAnalysisSchema, PriceConfirmationSchema, type SiteAnalysisModel } from '../schemas/analysis.js';
import { parseBriefYaml } from './01-brief.js';
import { INSTAGRAM_NO_SCREENSHOTS_REASON, confirmPrices, mergeAnalysis, parsePriceAnswer } from './02-analysis.js';

const { brief } = parseBriefYaml(readFileSync(path.join(findRepoRoot(), 'brief.example.yaml'), 'utf8'));
const NOW = '2026-10-30T12:00:00.000Z';

const merge = (site: SiteAnalysisModel = siteFixture, withInstagram = true) =>
  mergeAnalysis({
    brief,
    site,
    siteSources: siteFixtureSources,
    instagram: withInstagram ? instagramFixture : null,
    screenshots: withInstagram ? ['01.png', '02.png'] : [],
    now: NOW,
  });

describe('mergeAnalysis', () => {
  it('assigns stable fact ids and keeps statuses from official sources', () => {
    const a = merge();
    expect(a.brandFacts.map((f) => f.id)).toEqual(['F-SITE-01', 'F-SITE-02', 'F-SITE-03', 'F-SITE-04', 'F-SITE-05', 'F-IG-01', 'F-IG-02']);
    expect(a.brandFacts[0]).toMatchObject({ status: 'verified', source: 'https://gymbeam.hr/', retrievedAt: NOW });
    expect(a.products.find((p) => p.name === WHEY)!.claims.map((c) => c.id)).toEqual(['F-P1-01', 'F-P1-02']);
    expect(a.instagramAccess).toBe('screenshots');
    expect(a.visualStyle.colorsHex).toEqual(['#111111', '#FFFFFF', '#FF6A00']);
    expect(a.sourcesUsed).toContainEqual({ source: 'https://gymbeam.hr/', title: '[MOCK] GymBeam Croatia — homepage', kind: 'web' });
    expect(a.sourcesUsed).toContainEqual({ source: '01.png', title: null, kind: 'screenshot' });
    expect(a.sourcesUnavailable.some((s) => s.source === brief.brand.instagramUrl)).toBe(true);
    expect(BrandAnalysisSchema.safeParse(a).success).toBe(true);
  });

  it('marks prices verified only when confident, on-domain and complete', () => {
    const a = merge();
    expect(a.products.find((p) => p.name === WHEY)!.price.status).toBe('verified');
    expect(a.products.find((p) => p.name === CREATINE)!.price.status).toBe('pending_confirmation');
    expect(a.products.find((p) => p.name === BAR)!.price).toMatchObject({ status: 'pending_confirmation', amount: 1.99 });
  });

  it('downgrades "verified" facts and prices from non-official domains', () => {
    const site = structuredClone(siteFixture) as SiteAnalysisModel;
    site.brandFacts[0]!.source = 'https://some-blog.example.com/gymbeam';
    site.products[0]!.price.sourceUrl = 'https://price-compare.example.com/';
    const a = merge(site);
    expect(a.brandFacts[0]!.status).toBe('assumption');
    expect(a.products[0]!.price.status).toBe('pending_confirmation');
    expect(a.products[0]!.price.note).toMatch(/not an official brand page/);
  });

  it('records Instagram as unavailable and keeps going without screenshots', () => {
    const a = merge(siteFixture, false);
    expect(a.instagramAccess).toBe('unavailable');
    expect(a.sourcesUnavailable).toContainEqual({ source: brief.brand.instagramUrl, reason: INSTAGRAM_NO_SCREENSHOTS_REASON });
    expect(a.tone).toBe(siteFixture.toneSignals);
    expect(a.visualStyle.colorsHex).toEqual([]);
  });

  it('keeps brief products missing from the model output as pending', () => {
    const site = { ...siteFixture, products: siteFixture.products.slice(0, 1) } as SiteAnalysisModel;
    const a = merge(site);
    expect(a.products).toHaveLength(3);
    expect(a.products[2]!.price.status).toBe('pending_confirmation');
    expect(a.sourcesUnavailable.some((s) => s.reason.includes(BAR))).toBe(true);
  });
});

describe('confirmPrices', () => {
  it('asks for every unverified price: answer → confirmed_by_user, null → omitted', async () => {
    const asked: string[] = [];
    const answers: Record<string, string | null> = { [`price:gymbeam-creatine-monohydrate`]: '24,90 €' };
    const { analysis, confirmations } = await confirmPrices(
      merge(),
      async (q) => {
        asked.push(q.id);
        return answers[q.id] ?? null;
      },
      () => {},
      () => NOW,
    );

    expect(asked).toEqual(['price:gymbeam-creatine-monohydrate', 'price:gymbeam-protein-bar']);
    const creatine = analysis.products.find((p) => p.name === CREATINE)!.price;
    expect(creatine).toMatchObject({ status: 'confirmed_by_user', amount: 24.9, currency: 'EUR', confirmedBy: 'user', confirmedAt: NOW });
    const bar = analysis.products.find((p) => p.name === BAR)!.price;
    expect(bar).toMatchObject({ status: 'omitted', amount: null, confirmedBy: null });
    expect(analysis.products.find((p) => p.name === WHEY)!.price.status).toBe('verified');

    expect(confirmations).toHaveLength(2);
    confirmations.forEach((c) => PriceConfirmationSchema.parse(c));
    expect(confirmations[1]).toMatchObject({ suggestedAnswer: '1.99', answer: null, status: 'omitted' });
  });

  it('treats an empty or unparseable answer as omitted', async () => {
    const { analysis } = await confirmPrices(merge(), async (q) => (q.id.endsWith('bar') ? 'n/a' : '   '), () => {});
    expect(analysis.products.filter((p) => p.price.status === 'omitted')).toHaveLength(2);
  });
});

describe('parsePriceAnswer', () => {
  it.each([
    ['24,90', 24.9],
    ['24.90 €', 24.9],
    ['EUR 9', 9],
    ['', null],
    ['free', null],
    ['0', null],
  ])('%s → %s', (input, expected) => expect(parsePriceAnswer(input)).toBe(expected));
});

describe('mock fixtures', () => {
  it('use __sources only on the site fixture', () => {
    expect(mockFixtures['analysis.site']).toHaveProperty('__sources');
    expect(mockFixtures['analysis.instagram']).not.toHaveProperty('__sources');
  });
});
