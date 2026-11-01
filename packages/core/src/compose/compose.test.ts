import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { canvasFor, composeSlide, cutOutWhite, formatPrice, layoutBoxes, pickAccent, prepareLogo, productSceneInput, type Box, type ComposeInput } from './compose.js';

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

/** Dark "tub" with a white label stripe on a white studio background. */
async function packshot(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#fff"/>
    <rect x="100" y="100" width="200" height="300" fill="#111"/><rect x="130" y="230" width="140" height="40" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Black bars standing in for a wordmark, on an opaque background (like a downloaded logo.png). */
async function wordmark(fill = '#000', background = '#fff'): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${background}"/>
    <rect x="40" y="70" width="100" height="60" fill="${fill}"/><rect x="160" y="70" width="100" height="60" fill="${fill}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { info, at: (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)] };
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
    logo: await wordmark(),
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

  it('shows a black-on-white logo without its white background on a dark slide', async () => {
    const res = await composeSlide(await input({ background: await solid(1024, 1024, '#202020') }));
    const box = res.placed.find((p) => p.element === 'logo')!.box;
    const { at } = await pixels(res.png);
    const [r, g, b] = at(box.left + Math.floor(box.width / 2), box.top + Math.floor(box.height / 2));
    // Centre of the logo is the gap between the bars: the dark slide shows through.
    expect(Math.max(r!, g!, b!)).toBeLessThan(80);
    expect(at(box.left + 2, box.top + Math.floor(box.height / 2)).slice(0, 3)).toEqual([255, 255, 255]);
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

  it('keeps white packaging opaque: only near-pure white counts as background', async () => {
    // Off-white tub (shaded like real white packaging) touching a lighter highlight band.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#fff"/>
      <rect x="100" y="100" width="200" height="300" fill="#e8e8e8"/><rect x="100" y="100" width="200" height="20" fill="#f6f6f6"/></svg>`;
    const cut = await cutOutWhite(await sharp(Buffer.from(svg)).png().toBuffer());
    const { info, at } = await pixels(cut);
    expect([info.width, info.height]).toEqual([200, 300]);
    expect(at(100, 150)[3]).toBe(255);
    expect(at(100, 10)[3]).toBe(255);
  });

  it('drops a pale reflection that is not attached to the product', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#fff"/>
      <rect x="100" y="100" width="200" height="250" fill="#e04020"/><ellipse cx="200" cy="420" rx="120" ry="10" fill="#eeeeee"/></svg>`;
    const cut = await cutOutWhite(await sharp(Buffer.from(svg)).png().toBuffer());
    expect(await sharp(cut).metadata()).toMatchObject({ width: 200, height: 250 });
  });

  it('keeps images that are already transparent', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await cutOutWhite(png);
    expect(await sharp(out).metadata()).toMatchObject({ width: 50, height: 50 });
  });
});

describe('productSceneInput', () => {
  it('masks only the product, which then lands exactly on the real product in compose', async () => {
    for (const [size, layout] of [['1024x1024', 'product-right'], ['1024x1536', 'product-center']] as const) {
      const scene = (await productSceneInput(canvasFor('carousel'), layout, await packshot(), size))!;
      const { info, at } = await pixels(scene.mask);
      expect(`${info.width}x${info.height}`).toBe(size);
      expect(at(5, 5)[3]).toBe(0);
      // A "model" that keeps the masked product and paints everything else light grey.
      const background = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: '#dddddd' } })
        .composite([{ input: await sharp(scene.image).removeAlpha().joinChannel(await sharp(scene.mask).extractChannel('alpha').png().toBuffer()).png().toBuffer() }])
        .png()
        .toBuffer();
      const res = await composeSlide(await input({ layout, background, productInScene: true, logo: null, headline: 'X', subtext: null }));
      const box = res.placed.find((p) => p.element === 'product')!.box;
      const out = await pixels(res.png);
      // Just outside the real product there is no dark edge of the product in the background (no ghost).
      for (const [x, y] of [[box.left - 4, box.top + box.height / 2], [box.left + box.width + 3, box.top + box.height / 2], [box.left + box.width / 2, box.top + box.height + 3]] as [number, number][]) {
        const [r] = out.at(Math.round(x), Math.round(y));
        expect(r).toBeGreaterThan(60);
      }
    }
  });

  it('returns null for a text-only layout', async () => {
    expect(await productSceneInput(canvasFor('carousel'), 'text-only', await packshot(), '1024x1024')).toBeNull();
  });
});

describe('prepareLogo', () => {
  it('turns a black logo on white into a white cut-out for a dark backdrop, cropped to the logo', async () => {
    const { info, at } = await pixels(await prepareLogo(await wordmark(), 0.2));
    expect([info.width, info.height]).toEqual([220, 60]);
    expect(at(10, 30)).toEqual([255, 255, 255, 255]);
    // The gap between the two bars is transparent, not a white box.
    expect(at(110, 30)[3]).toBe(0);
  });

  it('paints a one-colour logo black on a light backdrop, whatever its original colours', async () => {
    const { at } = await pixels(await prepareLogo(await wordmark('#fff', '#000'), 0.9));
    expect(at(10, 30)).toEqual([0, 0, 0, 255]);
  });

  it('keeps the colours of a multi-colour logo and removes its white background', async () => {
    const { at } = await pixels(await prepareLogo(await wordmark('#FF6A00'), 0.2));
    expect(at(10, 30)).toEqual([255, 106, 0, 255]);
    expect(at(110, 30)[3]).toBe(0);
  });
});

describe('helpers', () => {
  it('formats prices in English', () => {
    expect(formatPrice(29.9, 'EUR')).toBe('€29.90');
    expect(formatPrice(1234.5, null)).toBe('€1,234.50');
  });

  it('picks a saturated brand colour as accent', () => {
    expect(pickAccent(['#111111', '#FFFFFF', '#FF6A00'])).toBe('#FF6A00');
    expect(pickAccent(['#111111', '#FFFFFF'])).toBe('#FF6A00');
  });
});
