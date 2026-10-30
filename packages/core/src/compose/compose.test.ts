import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { canvasFor, composeSlide, cutOutWhite, formatPriceHr, layoutBoxes, pickAccent, type Box, type ComposeInput } from './compose.js';

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

/** Dark "tub" with a white label stripe on a white studio background. */
async function packshot(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#fff"/>
    <rect x="100" y="100" width="200" height="300" fill="#111"/><rect x="130" y="230" width="140" height="40" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function input(overrides: Partial<ComposeInput> = {}): Promise<ComposeInput> {
  return {
    canvas: canvasFor('carousel'),
    layout: 'product-right',
    background: await solid(1024, 1024, '#335577'),
    headline: 'Upoznaj naš kreatin',
    subtext: 'Kratki vodič prije kupnje',
    priceLabel: null,
    product: await packshot(),
    productPlaceholder: 'GymBeam Creatine Monohydrate',
    logo: await solid(300, 100, '#ffffff'),
    colorsHex: ['#111111', '#FF6A00'],
    font: 'sans bold',
    ...overrides,
  };
}

const inside = (inner: Box, outer: { width: number; height: number }) =>
  inner.left >= 0 && inner.top >= 0 && inner.left + inner.width <= outer.width && inner.top + inner.height <= outer.height;

describe('canvasFor', () => {
  it('uses 4:5 for feed posts and 9:16 for stories', () => {
    expect(canvasFor('carousel')).toEqual({ width: 1080, height: 1350 });
    expect(canvasFor('single')).toEqual({ width: 1080, height: 1350 });
    expect(canvasFor('story')).toEqual({ width: 1080, height: 1920 });
  });
});

describe('layoutBoxes', () => {
  it('keeps every box inside the canvas and text clear of the product', () => {
    for (const format of ['carousel', 'story'] as const) {
      for (const layout of ['text-only', 'product-center', 'product-left', 'product-right'] as const) {
        const canvas = canvasFor(format);
        const b = layoutBoxes(canvas, layout);
        expect(inside(b.text, canvas)).toBe(true);
        expect(inside(b.logo, canvas)).toBe(true);
        if (layout === 'text-only') expect(b.product).toBeNull();
        else {
          expect(inside(b.product!, canvas)).toBe(true);
          const overlapX = b.text.left < b.product!.left + b.product!.width && b.product!.left < b.text.left + b.text.width;
          const overlapY = b.text.top < b.product!.top + b.product!.height && b.product!.top < b.text.top + b.text.height;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    }
  });
});

describe('composeSlide', () => {
  it('outputs the exact canvas size for feed and story, from any background size', async () => {
    const feed = await composeSlide(await input());
    expect(await sharp(feed.png).metadata()).toMatchObject({ width: 1080, height: 1350 });
    const story = await composeSlide(await input({ canvas: canvasFor('story'), background: await solid(1536, 1024, '#222') }));
    expect(await sharp(story.png).metadata()).toMatchObject({ width: 1080, height: 1920 });
  });

  it('fits long headlines inside the text box (no overflow)', async () => {
    const res = await composeSlide(
      await input({ headline: 'Ovo je namjerno jako dugačak naslov koji se mora smanjiti da stane u okvir slajda bez prelijevanja', subtext: null }),
    );
    const text = res.placed.find((p) => p.element === 'text')!.box;
    expect(text.width).toBeLessThanOrEqual(res.layout.text.width);
    expect(text.height).toBeLessThanOrEqual(res.layout.text.height);
  });

  it('places product, logo and price badge inside the canvas', async () => {
    const res = await composeSlide(await input({ priceLabel: '29,90 €' }));
    expect(res.placed.map((p) => p.element).sort()).toEqual(['logo', 'price', 'product', 'text']);
    for (const p of res.placed) expect(inside(p.box, canvasFor('carousel'))).toBe(true);
  });

  it('uses a labelled placeholder when the product photo is missing, and works without a logo', async () => {
    const res = await composeSlide(await input({ product: null, logo: null }));
    expect(res.placed.map((p) => p.element).sort()).toEqual(['product-placeholder', 'text']);
  });
});

describe('cutOutWhite', () => {
  it('removes the white studio background but keeps white areas inside the product', async () => {
    const cut = await cutOutWhite(await packshot());
    const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // trim() crops to the product (200×300 plus a feathered edge).
    expect(info.width).toBeLessThanOrEqual(210);
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    // White label stripe in the middle of the product stays opaque.
    expect(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBe(255);
  });

  it('keeps images that are already transparent', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await cutOutWhite(png);
    expect(await sharp(out).metadata()).toMatchObject({ width: 50, height: 50 });
  });
});

describe('helpers', () => {
  it('formats prices the Croatian way', () => {
    expect(formatPriceHr(29.9, 'EUR')).toBe('29,90 €');
    expect(formatPriceHr(1234.5, null)).toBe('1.234,50 €');
  });

  it('picks a saturated brand colour as accent', () => {
    expect(pickAccent(['#111111', '#FFFFFF', '#FF6A00'])).toBe('#FF6A00');
    expect(pickAccent(['#111111', '#FFFFFF'])).toBe('#FF6A00');
  });
});
