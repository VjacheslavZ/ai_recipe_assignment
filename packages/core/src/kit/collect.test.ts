import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../ai/mock.js';
import type { AiClient } from '../ai/types.js';
import { parseConfig } from '../config.js';
import { normalizeBrief } from '../schemas/brief.js';
import { applyCollectedToYaml, collectBrandKit, productFileName } from './collect.js';
import { findLogoCandidates, findProductImages, findResultLinks } from './extract.js';

const config = parseConfig({ AI_PROVIDER: 'mock' }, '/tmp');
const SITE = 'https://shop.example.hr';

const HOME = `<html><head>
<script type="application/ld+json">{"@type":"Organization","logo":"${SITE}/static/logo.svg"}</script>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/touch.png"></head>
<body><a href="/">Home</a><a href="/proteini.html">Proteini</a></body></html>`;
const SEARCH = `<html><body><a href="/proteini.html">Proteini</a>
<a href="${SITE}/protein-wpc-80.html" class="product-item">+GIFT True Whey - Example</a>
<a href="${SITE}/clear-whey.html" class="product-item">Clear Whey - Example</a></body></html>`;
const PRODUCT = `<html><head><meta property="og:image" content="${SITE}/media/true-whey.jpg">
<script type="application/ld+json">{"@type":"Product","name":"True Whey","image":["${SITE}/media/true-whey.jpg","${SITE}/media/table.jpg"]}</script></head></html>`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="231" height="47"><rect width="231" height="47" fill="#ff8c32"/></svg>';

async function site(): Promise<{ fetch: typeof fetch; requested: string[] }> {
  const jpg = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const requested: string[] = [];
  const routes: Record<string, [string, string | Buffer]> = {
    [`${SITE}/`]: ['text/html', HOME],
    [`${SITE}/catalogsearch/result/?q=Example%20True%20Whey`]: ['text/html', SEARCH],
    [`${SITE}/protein-wpc-80.html`]: ['text/html', PRODUCT],
    [`${SITE}/static/logo.svg`]: ['image/svg+xml', SVG],
    [`${SITE}/touch.png`]: ['image/png', await sharp(jpg).resize(180, 180).png().toBuffer()],
    [`${SITE}/media/true-whey.jpg`]: ['image/jpeg', jpg],
    [`${SITE}/media/table.jpg`]: ['image/jpeg', jpg],
  };
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route[1], { status: 200, headers: { 'content-type': route[0] } });
  }) as typeof fetch;
  return { fetch: fake, requested };
}

const { brief } = normalizeBrief({
  brand: { name: 'Example Shop', slug: 'example', instagramHandle: '@example', website: SITE, whyThisBrand: 'test' },
  products: [{ name: 'Example True Whey' }, { name: 'Example Mystery Bar' }],
  audience: 'a',
  goals: ['g'],
});

describe('extract', () => {
  it('finds the JSON-LD logo first, skips .ico, and finds product images and search results', () => {
    expect(findLogoCandidates(HOME, SITE)).toEqual([`${SITE}/static/logo.svg`, `${SITE}/touch.png`]);
    expect(findProductImages(PRODUCT, SITE)).toEqual([`${SITE}/media/true-whey.jpg`, `${SITE}/media/table.jpg`]);
    // Navigation links that are also on the home page are not results.
    expect(findResultLinks(SEARCH, HOME, SITE)).toEqual([
      { url: `${SITE}/protein-wpc-80.html`, title: '+GIFT True Whey - Example' },
      { url: `${SITE}/clear-whey.html`, title: 'Clear Whey - Example' },
    ]);
  });
});

describe('collectBrandKit', () => {
  it('downloads the logo and the packshot the models chose, records sources and never uses an invented page', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'recipe-kit-'));
    const { fetch, requested } = await site();
    const ai = createMockClient(config, {
      delayMs: 0,
      fixtures: {
        'kit.match': {
          matches: [
            { product: 'Example True Whey', url: `${SITE}/protein-wpc-80.html`, reason: 'title matches' },
            { product: 'Example Mystery Bar', url: `${SITE}/invented-bar.html`, reason: 'guess' },
          ],
        },
        'kit.logo': { choice: 1, reason: 'wordmark' },
        'kit.product': { choice: 1, reason: 'front of pack' },
      },
    });
    const res = await collectBrandKit(ai, { brief, brandKitDir: dir, fetch });

    expect(res.items.map((i) => [i.kind, i.status])).toEqual([
      ['logo', 'collected'],
      ['product', 'collected'],
      ['product', 'not_found'],
    ]);
    const logo = await sharp(path.join(dir, 'example', 'logo.png')).metadata();
    expect(logo.width).toBeGreaterThanOrEqual(1100); // SVG rendered large
    expect(existsSync(path.join(dir, 'example', 'products', productFileName('Example True Whey')))).toBe(true);
    expect(res.products).toEqual([
      { name: 'Example True Whey', url: `${SITE}/protein-wpc-80.html`, imageFile: 'example-true-whey.png' },
      { name: 'Example Mystery Bar', url: null, imageFile: null },
    ]);
    expect(requested).not.toContain(`${SITE}/invented-bar.html`);
    const sources = JSON.parse(readFileSync(path.join(dir, 'example', 'sources.json'), 'utf8')) as { file: string; sourceUrl: string }[];
    expect(sources.map((s) => [s.file, s.sourceUrl])).toEqual([
      ['logo.png', `${SITE}/static/logo.svg`],
      ['products/example-true-whey.png', `${SITE}/media/true-whey.jpg`],
    ]);
    expect(res.calls.map((c) => c.purpose)).toEqual(['kit.logo', 'kit.match', 'kit.product.p1']);

    // A second run checks what is already in the kit and keeps it.
    const known = { ...brief.products[0]!, url: `${SITE}/protein-wpc-80.html`, imageFile: 'example-true-whey.png' };
    const again = await collectBrandKit(ai, { brief: { ...brief, products: [known] }, brandKitDir: dir, fetch });
    expect(again.items.map((i) => i.status)).toEqual(['kept', 'kept']);
    expect(again.calls.map((c) => c.purpose)).toEqual(['kit.product.p1']);

    // A product whose photo is already there still gets its page looked up (facts and prices).
    const pageOnly = await collectBrandKit(ai, { brief: { ...brief, products: [{ ...known, url: null }] }, brandKitDir: dir, fetch });
    expect(pageOnly.products[0]).toMatchObject({ url: `${SITE}/protein-wpc-80.html`, imageFile: 'example-true-whey.png' });
    expect(pageOnly.items[1]).toMatchObject({ status: 'kept', pageUrl: `${SITE}/protein-wpc-80.html` });
  });

  it('replaces a kit photo that the vision check says is a different product, keeping the file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'recipe-kit-'));
    mkdirSync(path.join(dir, 'example', 'products'), { recursive: true });
    await sharp({ create: { width: 300, height: 300, channels: 3, background: '#00ff00' } }).png().toFile(path.join(dir, 'example', 'products', 'whey.png'));
    await sharp({ create: { width: 300, height: 100, channels: 3, background: '#000000' } }).png().toFile(path.join(dir, 'example', 'logo.png'));
    const { fetch } = await site();
    const mock = createMockClient(config, { delayMs: 0, fixtures: { 'kit.product': { choice: 1, reason: 'front of pack' } } });
    let checks = 0;
    // The first look (the user's photo) says no; the site's packshot is accepted.
    const ai: AiClient = {
      ...mock,
      structured: async (req) => {
        const res = await mock.structured(req);
        return checks++ === 0 ? { ...res, data: { choice: null, reason: 'this is Just Whey' } as typeof res.data } : res;
      },
    };
    const product = { ...brief.products[0]!, url: `${SITE}/protein-wpc-80.html`, imageFile: 'whey.png' };
    const res = await collectBrandKit(ai, { brief: { ...brief, products: [product] }, brandKitDir: dir, fetch });
    expect(res.products[0]?.imageFile).toBe('example-true-whey.png');
    expect(res.items[1]).toMatchObject({ status: 'collected' });
    expect(res.items[1]?.note).toMatch(/Your photo whey\.png looks like a different product \(this is Just Whey\)/);
    expect(existsSync(path.join(dir, 'example', 'products', 'whey.png'))).toBe(true);
  });

  it('writes found pages and photos into the brief YAML', () => {
    const yaml = '# header\nproducts:\n  - name: A\n    image_file: old.png\n  - name: B\n';
    expect(applyCollectedToYaml(yaml, [{ name: 'A', url: 'https://x.hr/a.html', imageFile: 'a.png' }])).toBe(
      '# header\nproducts:\n  - name: A\n    url: https://x.hr/a.html\n    imageFile: a.png\n  - name: B\n',
    );
  });
});
