import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../config.js';
import { FIXTURE_BRIEF } from '../fixtures/index.js';
import { BriefArtifactSchema, BriefValidationError, DEFAULT_CONSTRAINTS, brandDomains } from '../schemas/brief.js';
import { briefStage, checkBrandKit, parseBriefYaml } from './01-brief.js';
import { fakeAi, makeContext, tempDir } from './test-helpers.js';

const EXAMPLE = path.join(findRepoRoot(), FIXTURE_BRIEF);
const DEMO = path.join(findRepoRoot(), 'brief.example.yaml');

const MINIMAL = `
brand:
  name: Test Brand
  slug: test-brand
  instagram_handle: testbrand
  website: https://test.example.hr
  why_this_brand: Because.
products:
  - name: Widget
audience: Everyone
goals: [education]
`;

describe('parseBriefYaml', () => {
  it('accepts the demo brief.example.yaml with product pages on the brand site', () => {
    const { brief, warnings } = parseBriefYaml(readFileSync(DEMO, 'utf8'));
    expect(brief.brand.slug).toBe('gymbeamhr');
    expect(brief.brand.instagramHandle).toBe('@gymbeamhr');
    expect(brief.products.length).toBeGreaterThanOrEqual(2);
    expect(brief.products.every((p) => p.url?.startsWith('https://gymbeam.hr/'))).toBe(true);
    expect(warnings).toEqual([]);
    expect(brandDomains(brief)).toEqual(['gymbeam.hr']);
  });

  it('treats a TODO product URL as not provided and warns', () => {
    const yaml = readFileSync(EXAMPLE, 'utf8').replace('url: https://gymbeam.hr/protein-wpc-80-gymbeam.html', 'url: "TODO: paste product page URL"');
    const { brief, warnings } = parseBriefYaml(yaml);
    expect(brief.products[0]?.url).toBeNull();
    expect(warnings.some((w) => w.includes('no valid product page URL'))).toBe(true);
  });

  it('fills defaults for missing optional fields and accepts snake_case keys', () => {
    const { brief } = parseBriefYaml(MINIMAL);
    expect(brief.brand.instagramHandle).toBe('@testbrand');
    expect(brief.brand.instagramUrl).toBe('https://www.instagram.com/testbrand/');
    expect(brief.brand.shopUrls).toEqual([]);
    expect(brief.market).toEqual({ country: 'HR' });
    expect(brief.products[0]).toEqual({ name: 'Widget', url: null, imageFile: null, notes: null });
    expect(brief.references).toEqual([]);
    expect(brief.constraints).toEqual([...DEFAULT_CONSTRAINTS]);
    expect(brief.notes).toBeNull();
  });

  it('rejects an invalid brief with a readable list of problems', () => {
    const bad = `
brand:
  name: X
  slug: Not A Slug
  instagramHandle: "@x"
  website: not-a-url
  whyThisBrand: y
products: []
goals: []
`;
    try {
      parseBriefYaml(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BriefValidationError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/brand\.slug: must be lowercase/);
      expect(msg).toMatch(/products: list at least one product/);
      expect(msg).toMatch(/audience/);
      expect(msg).toMatch(/goals: list at least one goal/);
    }
  });

  it('rejects an invalid website and broken YAML', () => {
    expect(() => parseBriefYaml(MINIMAL.replace('https://test.example.hr', 'test.example.hr'))).toThrow(/brand\.website/);
    expect(() => parseBriefYaml('brand: [unclosed')).toThrow(/YAML syntax/);
  });
});

describe('checkBrandKit', () => {
  it('reports missing files without throwing', () => {
    const { brief } = parseBriefYaml(readFileSync(EXAMPLE, 'utf8'));
    const kit = checkBrandKit(tempDir('kit'), brief);
    expect(kit.logo).toBeNull();
    expect(kit.instagramScreenshots).toEqual([]);
    expect(kit.products.every((p) => !p.exists)).toBe(true);
    expect(kit.missing).toContain('logo.png');
  });

  it('finds existing logo, product images and screenshots', () => {
    const { brief } = parseBriefYaml(readFileSync(EXAMPLE, 'utf8'));
    const kitDir = tempDir('kit');
    const dir = kitDir;
    mkdirSync(path.join(dir, 'instagram'), { recursive: true });
    mkdirSync(path.join(dir, 'products'), { recursive: true });
    writeFileSync(path.join(dir, 'logo.png'), '');
    writeFileSync(path.join(dir, 'products', brief.products[0]!.imageFile!), '');
    for (const f of ['02.png', '01.jpg', 'notes.txt']) writeFileSync(path.join(dir, 'instagram', f), '');
    const kit = checkBrandKit(kitDir, brief);
    expect(kit.logo).toBe('logo.png');
    expect(kit.products[0]!.exists).toBe(true);
    expect(kit.instagramScreenshots).toEqual(['01.jpg', '02.png']);
  });
});

describe('briefStage', () => {
  it('writes brief.json and brief.md from brief.input.yaml', async () => {
    const ctx = makeContext({ ai: fakeAi({}), kitDir: tempDir('kit') });
    copyFileSync(EXAMPLE, ctx.store.path('brief', 'brief.input.yaml'));
    await briefStage.run(ctx);
    const artifact = ctx.store.readJson('brief', 'brief.json', BriefArtifactSchema);
    expect(artifact.brandKit.missing.length).toBeGreaterThan(0);
    expect(ctx.logs.some((l) => l.startsWith('warning: brand kit: missing'))).toBe(true);
    expect(readFileSync(ctx.store.path('brief', 'brief.md'), 'utf8')).toContain('# Brief — GymBeam Croatia');
  });
});
