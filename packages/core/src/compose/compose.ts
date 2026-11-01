import sharp, { type OverlayOptions } from 'sharp';
import type { PostFormat, SlideLayout } from '../schemas/plan.js';

export interface Canvas {
  width: number;
  height: number;
}

/** Instagram canvases: 4:5 feed posts, 9:16 story frames. */
export function canvasFor(format: PostFormat): Canvas {
  return format === 'story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
}

export interface ComposeInput {
  canvas: Canvas;
  layout: SlideLayout;
  background: Buffer;
  headline: string;
  subtext: string | null;
  /** Already formatted, e.g. "99,99 €"; null hides the price badge. */
  priceLabel: string | null;
  /** Real product photo (transparent PNG or white background), or null for none. */
  product: Buffer | null;
  /** Shown instead of a product photo when the slide needs a product but the brand kit has none. */
  productPlaceholder: string | null;
  logo: Buffer | null;
  /** Brand colours; the first is used as accent (price badge, text highlight). */
  colorsHex: string[];
  font: string;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ComposeLayout {
  text: Box;
  product: Box | null;
  logo: Box;
  textAlign: 'left' | 'centre';
}

const MARGIN = 72;

/** Pure geometry for a layout, exported so tests and the QA stage can reason about it. */
export function layoutBoxes(canvas: Canvas, layout: SlideLayout): ComposeLayout {
  const { width: w, height: h } = canvas;
  const inner = w - 2 * MARGIN;
  const logo: Box = { left: MARGIN, top: MARGIN, width: 260, height: 90 };
  const textTop = MARGIN + logo.height + 40;
  switch (layout) {
    case 'text-only':
      return { text: { left: MARGIN, top: textTop, width: inner, height: Math.round(h * 0.45) }, product: null, logo, textAlign: 'left' };
    case 'product-center': {
      const textH = Math.round(h * 0.24);
      const productTop = textTop + textH + 30;
      return {
        text: { left: MARGIN, top: textTop, width: inner, height: textH },
        product: { left: MARGIN, top: productTop, width: inner, height: h - productTop - MARGIN },
        logo,
        textAlign: 'centre',
      };
    }
    case 'product-left':
    case 'product-right': {
      const half = Math.round((inner - 40) / 2);
      const productBox: Box = { left: 0, top: textTop, width: half, height: h - textTop - MARGIN };
      const textBox: Box = { left: 0, top: textTop, width: half, height: Math.round(h * 0.5) };
      if (layout === 'product-left') {
        productBox.left = MARGIN;
        textBox.left = MARGIN + half + 40;
      } else {
        textBox.left = MARGIN;
        productBox.left = MARGIN + half + 40;
      }
      return { text: textBox, product: productBox, logo, textAlign: 'left' };
    }
  }
}

function escapeMarkup(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders text into a box: sharp/Pango wraps at the box width and auto-fits the
 * height; the dpi cap keeps short headlines from becoming poster-sized.
 */
export async function renderText(opts: {
  markup: string;
  font: string;
  width: number;
  height: number;
  maxDpi: number;
  align: 'left' | 'centre';
}): Promise<{ png: Buffer; width: number; height: number }> {
  const base = { text: opts.markup, font: opts.font, width: opts.width, rgba: true, align: opts.align, wrap: 'word' as const };
  let out = await sharp({ text: { ...base, height: opts.height } }).png().toBuffer({ resolveWithObject: true });
  if ((out.info.textAutofitDpi ?? 0) > opts.maxDpi) {
    out = await sharp({ text: { ...base, dpi: opts.maxDpi } }).png().toBuffer({ resolveWithObject: true });
  }
  return { png: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Makes the white studio background of a packshot transparent. Flood-fills from
 * the image border so white areas inside the product (label text, lids) stay opaque.
 * Only near-pure white is background: white packaging is shaded (about 230–245) and
 * a looser threshold let the fill run into the tub and make it see-through.
 */
export async function cutOutWhite(product: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(product).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Already cut out (transparent corner): only crop the empty margin, so the product fills its box.
  if ((data[3] ?? 255) < 250) return sharp(product).trim().png().toBuffer().catch(() => sharp(product).png().toBuffer());

  const minChannel = (p: number) => Math.min(data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!);
  const background = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const neighbours = (p: number) => {
    const x = p % w;
    return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1].filter((q) => q >= 0);
  };
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    if (minChannel(p) < 250) continue;
    background[p] = 1;
    data[p * 4 + 3] = 0;
    stack.push(...neighbours(p));
  }
  // Soft edge: the one-pixel ring of product next to the background fades by its lightness.
  for (let p = 0; p < w * h; p++) {
    if (background[p] || !neighbours(p).some((q) => background[q])) continue;
    data[p * 4 + 3] = Math.min(255, Math.round(((255 - minChannel(p)) / 40) * 255));
  }
  // A studio shadow or reflection that is not attached to the product (light grey, no colour,
  // no dark pixels) would show as a pale smudge on a dark slide: drop it. Separate parts with
  // colour or dark areas (e.g. a second item in the shot) stay.
  const part = new Int32Array(w * h).fill(-1);
  const parts: { size: number; pale: boolean }[] = [];
  for (let start = 0; start < w * h; start++) {
    if (background[start] || part[start]! >= 0) continue;
    const id = parts.length;
    const info = { size: 0, pale: true };
    parts.push(info);
    stack.push(start);
    part[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      info.size++;
      const i = p * 4;
      if (minChannel(p) < 200 || Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - minChannel(p) > 12) info.pale = false;
      for (const q of neighbours(p)) {
        if (background[q] || part[q]! >= 0) continue;
        part[q] = id;
        stack.push(q);
      }
    }
  }
  const largest = parts.reduce((best, p, i) => (p.size > (parts[best]?.size ?? 0) ? i : best), 0);
  for (let p = 0; p < w * h; p++) {
    if (part[p]! < 0 || part[p] === largest || !parts[part[p]!]!.pale) continue;
    // White as well as transparent, so trim() crops it away like the background.
    data.fill(255, p * 4, p * 4 + 3);
    data[p * 4 + 3] = 0;
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim().png().toBuffer();
}

/**
 * Makes a logo file usable on any slide. A one-colour logo (e.g. a black wordmark on
 * white, the usual download) becomes a transparent mask, painted white on a dark
 * backdrop and black on a light one. A multi-colour logo keeps its colours; only a
 * white background is removed. The result is cropped to the logo itself.
 */
export async function prepareLogo(logo: Buffer, backdropLuminance: number): Promise<Buffer> {
  const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const transparent = (data[3] ?? 255) < 250;
  const [br, bg, bb] = [data[0]!, data[1]!, data[2]!];
  // How strongly each pixel belongs to the logo: its alpha, or its distance from the background colour.
  const ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    ink[p] = transparent ? data[i + 3]! : Math.max(Math.abs(data[i]! - br), Math.abs(data[i + 1]! - bg), Math.abs(data[i + 2]! - bb));
  }
  let maxInk = 0;
  let inkPixels = 0;
  let colourful = 0;
  for (let p = 0; p < n; p++) {
    maxInk = Math.max(maxInk, ink[p]!);
    if (ink[p]! < 128) continue;
    inkPixels++;
    const i = p * 4;
    if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 60) colourful++;
  }
  // Blank image: nothing to cut out.
  if (!inkPixels) return sharp(logo).png().toBuffer();

  let out: Buffer;
  if (colourful / inkPixels < 0.05) {
    const v = backdropLuminance > 0.6 ? 0 : 255;
    out = Buffer.alloc(n * 4);
    for (let p = 0; p < n; p++) {
      out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = v;
      out[p * 4 + 3] = transparent ? ink[p]! : Math.round((ink[p]! * 255) / maxInk);
    }
  } else {
    if (!transparent) return cutOutWhite(logo);
    out = data;
  }
  // Crop to the visible pixels (trim() would compare colours, which are uniform here).
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let p = 0; p < n; p++) {
    if (out[p * 4 + 3]! < 16) continue;
    const x = p % w;
    const y = Math.floor(p / w);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png()
    .toBuffer();
}

async function fitInto(img: Buffer, box: Box): Promise<{ png: Buffer; left: number; top: number; width: number; height: number }> {
  const { data, info } = await sharp(img)
    .resize({ width: box.width, height: box.height, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    png: data,
    width: info.width,
    height: info.height,
    left: box.left + Math.round((box.width - info.width) / 2),
    top: box.top + Math.round((box.height - info.height) / 2),
  };
}

/** Soft drop shadow made from the product's own alpha channel. */
async function shadowOf(png: Buffer, width: number, height: number): Promise<Buffer> {
  const alpha = await sharp(png).extractChannel('alpha').toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#000000' } })
    .joinChannel(alpha)
    .blur(18)
    .linear([1, 1, 1, 0.45], [0, 0, 0, 0])
    .png()
    .toBuffer();
}

function svg(width: number, height: number, body: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
}

/** Darkens the text side of the background so white type stays readable on any generated scene. */
function scrim(canvas: Canvas, text: Box): Buffer {
  const { width: w, height: h } = canvas;
  const cy = (text.top + text.height / 2) / h;
  const cx = (text.left + text.width / 2) / w;
  return svg(
    w,
    h,
    `<defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="0.75">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/>` +
      `</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`,
  );
}

function placeholderSvg(box: Box, label: string): Buffer {
  // Wrap the product name into short lines so it never overflows the box.
  const words = label.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${w}`.length <= 18) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const fontSize = Math.min(40, Math.floor((box.width - 60) / 11));
  const startY = box.height / 2 - ((lines.length - 1) * fontSize * 1.25) / 2;
  const tspans = ['PRODUCT PHOTO MISSING', ...lines]
    .map((l, i) => `<tspan x="50%" y="${startY + (i - 1) * fontSize * 1.25}">${escapeMarkup(l)}</tspan>`)
    .join('');
  return svg(
    box.width,
    box.height,
    `<rect x="4" y="4" width="${box.width - 8}" height="${box.height - 8}" rx="32" fill="#FFFFFF" fill-opacity="0.12" stroke="#FFFFFF" stroke-width="4" stroke-dasharray="18 14"/>` +
      `<text fill="#FFFFFF" font-family="sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${tspans}</text>`,
  );
}

/** Most saturated brand colour: near-black/white palette entries make poor badges. */
export function pickAccent(colorsHex: string[], fallback = '#FF6A00'): string {
  let best: { hex: string; sat: number } | null = null;
  for (const hex of colorsHex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) continue;
    const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > 0.35 && max > 0.35 && (!best || sat > best.sat)) best = { hex, sat };
  }
  return best?.hex ?? fallback;
}

function badgeSvg(label: string, accent: string): { png: Buffer; width: number; height: number } {
  const width = Math.max(320, 60 + label.length * 38);
  const height = 140;
  return {
    png: svg(
      width,
      height,
      `<rect width="${width}" height="${height}" rx="70" fill="${accent}"/>` +
        `<text x="50%" y="66%" fill="#FFFFFF" font-family="sans-serif" font-size="68" font-weight="800" text-anchor="middle">${escapeMarkup(label)}</text>`,
    ),
    width,
    height,
  };
}

export interface ComposeResult {
  png: Buffer;
  layout: ComposeLayout;
  /** Where each element actually landed, for compose_specs.json and the QA stage. */
  placed: { element: 'text' | 'product' | 'product-placeholder' | 'logo' | 'price'; box: Box }[];
}

/**
 * Builds one finished slide: generated background (cover-cropped) + scrim +
 * real product cut-out with shadow + real logo + headline/subtext + price badge.
 * Product and logo are never generated (ADR-004), only placed.
 */
export async function composeSlide(input: ComposeInput): Promise<ComposeResult> {
  const { canvas } = input;
  const layout = layoutBoxes(canvas, input.layout);
  const accent = pickAccent(input.colorsHex);
  const backdrop = await sharp(input.background)
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'attention' })
    .composite([{ input: scrim(canvas, layout.text), left: 0, top: 0 }])
    .png()
    .toBuffer();
  const layers: OverlayOptions[] = [];
  const placed: ComposeResult['placed'] = [];

  if (layout.product) {
    if (input.product) {
      const cut = await cutOutWhite(input.product);
      const fit = await fitInto(cut, layout.product);
      layers.push({ input: await shadowOf(fit.png, fit.width, fit.height), left: fit.left + 14, top: fit.top + 26 });
      layers.push({ input: fit.png, left: fit.left, top: fit.top });
      placed.push({ element: 'product', box: { left: fit.left, top: fit.top, width: fit.width, height: fit.height } });
    } else if (input.productPlaceholder) {
      layers.push({ input: placeholderSvg(layout.product, input.productPlaceholder), left: layout.product.left, top: layout.product.top });
      placed.push({ element: 'product-placeholder', box: layout.product });
    }
  }

  const headline = `<span foreground="#FFFFFF" weight="heavy">${escapeMarkup(input.headline.toUpperCase())}</span>`;
  const sub = input.subtext ? `\n<span foreground="#FFFFFF" weight="normal" size="60%">${escapeMarkup(input.subtext)}</span>` : '';
  const text = await renderText({
    markup: headline + sub,
    font: input.font,
    width: layout.text.width,
    height: layout.text.height,
    // Pango renders 12 pt by default: 640 dpi ≈ 105 px headlines; autofit shrinks long copy.
    maxDpi: 640,
    align: layout.textAlign,
  });
  const textLeft = layout.textAlign === 'centre' ? layout.text.left + Math.round((layout.text.width - text.width) / 2) : layout.text.left;
  layers.push({ input: text.png, left: textLeft, top: layout.text.top });
  placed.push({ element: 'text', box: { left: textLeft, top: layout.text.top, width: text.width, height: text.height } });

  if (input.logo) {
    const { channels } = await sharp(backdrop).extract(layout.logo).stats();
    const luminance = (0.2126 * channels[0]!.mean + 0.7152 * channels[1]!.mean + 0.0722 * channels[2]!.mean) / 255;
    const fit = await fitInto(await prepareLogo(input.logo, luminance), layout.logo);
    // Left-align the logo inside its box instead of centring it.
    layers.push({ input: fit.png, left: layout.logo.left, top: fit.top });
    placed.push({ element: 'logo', box: { left: layout.logo.left, top: fit.top, width: fit.width, height: fit.height } });
  }

  if (input.priceLabel) {
    const badge = badgeSvg(input.priceLabel, accent);
    const area = layout.product ?? layout.text;
    const left = Math.min(canvas.width - MARGIN - badge.width, area.left + area.width - badge.width);
    const top = Math.min(canvas.height - MARGIN - badge.height, area.top + area.height - badge.height);
    layers.push({ input: badge.png, left, top });
    placed.push({ element: 'price', box: { left, top, width: badge.width, height: badge.height } });
  }

  const png = await sharp(backdrop)
    .composite(layers)
    .png()
    .toBuffer();
  return { png, layout, placed };
}

/** English price format, e.g. 29.9 EUR → "€29.90". */
export function formatPrice(amount: number, currency: string | null): string {
  const n = amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return !currency || currency.toUpperCase() === 'EUR' ? `€${n}` : `${n} ${currency.toUpperCase()}`;
}
