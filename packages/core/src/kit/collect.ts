import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type { AiCallRecord, AiClient } from '../ai/types.js';
import { buildImagePickPrompt, buildProductPageMatchPrompt } from '../prompts/kit.js';
import { brandDomains, type Brief } from '../schemas/brief.js';
import { ImagePickModelSchema, ProductPageMatchModelSchema, type KitItem, type KitSource } from '../schemas/kit.js';
import { findLogoCandidates, findProductImages, findResultLinks, searchUrls, type LinkCandidate } from './extract.js';

const UA = 'Mozilla/5.0 (compatible; PostRecipe/1.0; brand kit collection for a demo)';
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
export const KIT_SOURCES_FILE = 'sources.json';

export interface CollectBrandKitOptions {
  brief: Brief;
  /** The run's input folder: the logo goes to `logo.png`, packshots to `products/`. */
  kitDir: string;
  /** Replace files that are already in the brand kit. */
  replace?: boolean;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface CollectBrandKitResult {
  items: KitItem[];
  /** Per brief product: the page found (when the brief had none) and the photo file to use. */
  products: { name: string; url: string | null; imageFile: string | null }[];
  calls: AiCallRecord[];
}

interface Downloaded {
  url: string;
  /** Raster PNG, at full size for saving. */
  png: Buffer;
}

/** `GymBeam True Whey Protein` → `gymbeam-true-whey-protein.png` */
export function productFileName(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product'}.png`;
}

/**
 * Collects the logo and product packshots from the brand's official website into
 * the run's input folder (ADR-030, ADR-033). Code finds candidates; a text model picks product pages
 * from the site search; a vision model checks each image. Nothing is generated: every file
 * is downloaded from the brand's site, and its source is recorded in `sources.json`.
 */
export async function collectBrandKit(ai: AiClient, opts: CollectBrandKitOptions): Promise<CollectBrandKitResult> {
  const { brief } = opts;
  const get = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const { kitDir } = opts;
  const domains = brandDomains(brief);
  const onBrandSite = (url: string) => domains.some((d) => new URL(url).hostname.replace(/^www\./, '').endsWith(d));
  const calls: AiCallRecord[] = [];
  const items: KitItem[] = [];
  const sources: KitSource[] = [];
  const tmp = mkdtempSync(path.join(tmpdir(), 'recipe-kit-'));
  const now = () => new Date().toISOString();

  async function request(url: string): Promise<Response> {
    const res = await get(new URL(url).href, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new Error(`too large (${length} bytes)`);
    return res;
  }

  async function page(url: string): Promise<string> {
    if (!onBrandSite(url)) throw new Error(`not on the brand's site (${domains.join(', ')})`);
    return (await request(url)).text();
  }

  /** Downloads an image and turns it into PNG; SVG logos are rendered about 1200 px wide. */
  async function image(url: string): Promise<Downloaded | null> {
    try {
      const res = await request(url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return null;
      const isSvg = /svg/i.test(res.headers.get('content-type') ?? '') || /\.svg(\?|$)/i.test(url);
      let img = sharp(buf);
      if (isSvg) {
        const width = (await img.metadata()).width ?? 300;
        img = sharp(buf, { density: Math.min(2400, Math.max(72, (72 * 1200) / width)) });
      }
      const png = await img.png().toBuffer();
      const meta = await sharp(png).metadata();
      if ((meta.width ?? 0) < 64 || (meta.height ?? 0) < 32) return null;
      return { url, png };
    } catch (err) {
      log(`kit: could not use ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Vision check: which candidate (if any) is the logo / the packshot. */
  async function pick(kind: 'logo' | 'product', candidates: Downloaded[], productName?: string, index = 0): Promise<{ chosen: Downloaded | null; reason: string }> {
    if (!candidates.length) return { chosen: null, reason: 'no images found' };
    // Thumbnails on mid-grey, so white and transparent logos stay visible to the model.
    const files = await Promise.all(
      candidates.map(async (c, i) => {
        const file = path.join(tmp, `${kind}-${index}-${i + 1}.png`);
        await sharp(c.png).resize(512, 512, { fit: 'inside' }).flatten({ background: '#808080' }).png().toFile(file);
        return file;
      }),
    );
    const prompt = buildImagePickPrompt({ kind, brandName: brief.brand.name, productName, count: files.length });
    const res = await ai.structured({
      purpose: kind === 'logo' ? 'kit.logo' : `kit.product.p${index + 1}`,
      schema: ImagePickModelSchema,
      schemaName: 'image_pick',
      system: prompt.system,
      input: prompt.input,
      images: files,
      model: 'vision',
    });
    calls.push(res.call);
    const n = res.data.choice;
    return { chosen: n !== null && n >= 1 && n <= candidates.length ? candidates[n - 1]! : null, reason: res.data.reason };
  }

  try {
    mkdirSync(path.join(kitDir, 'products'), { recursive: true });
    let home = '';
    try {
      home = await page(brief.brand.website);
    } catch (err) {
      log(`kit: website not reachable: ${(err as Error).message}`);
    }

    // Logo
    const logoFile = path.join(kitDir, 'logo.png');
    if (existsSync(logoFile) && !opts.replace) {
      items.push({ kind: 'logo', product: null, file: 'logo.png', status: 'kept', sourceUrl: null, pageUrl: null, note: 'already in the brand kit' });
    } else {
      const candidates = (await Promise.all(findLogoCandidates(home, brief.brand.website).map(image))).filter((c): c is Downloaded => c !== null);
      const { chosen, reason } = await pick('logo', candidates);
      if (chosen) {
        writeFileSync(logoFile, chosen.png);
        sources.push({ file: 'logo.png', sourceUrl: chosen.url, pageUrl: brief.brand.website, retrievedAt: now(), checkedBy: 'vision model (kit.logo)', note: reason });
      }
      items.push({ kind: 'logo', product: null, file: chosen ? 'logo.png' : null, status: chosen ? 'collected' : 'not_found', sourceUrl: chosen?.url ?? null, pageUrl: brief.brand.website, note: reason });
    }

    // Photos already in the kit are checked too: matching a product to a file by its name can
    // pick a different product of the same brand (found with "whey.jpeg" → Just Whey, not True Whey).
    const checked = new Map<string, string>();
    const rejected = new Map<string, string>();
    for (const [i, p] of brief.products.entries()) {
      const file = p.imageFile ? path.join(kitDir, 'products', p.imageFile) : null;
      if (opts.replace || !file || !existsSync(file)) continue;
      const own: Downloaded = { url: file, png: await sharp(file).png().toBuffer() };
      const { chosen, reason } = await pick('product', [own], p.name, i);
      (chosen ? checked : rejected).set(p.name, reason);
    }
    const todo = brief.products
      .map((p, i) => ({ ...p, index: i }))
      .filter((p) => opts.replace || rejected.has(p.name) || !(p.imageFile && existsSync(path.join(kitDir, 'products', p.imageFile))));
    // Pages are looked up for every product without a URL, also when its photo is already in the
    // kit: stage 02 reads facts and prices from them.
    const pages = new Map<string, string | null>(brief.products.map((p) => [p.name, p.url]));
    const needSearch = brief.products.filter((p) => !p.url);
    if (needSearch.length && home) {
      const candidates = new Map<string, LinkCandidate[]>();
      let working: number | null = null;
      for (const p of needSearch) {
        const urls = searchUrls(brief.brand.website, p.name);
        for (const [i, url] of urls.entries()) {
          if (working !== null && i !== working) continue;
          try {
            const results = findResultLinks(await page(url), home, brief.brand.website);
            if (results.length) {
              candidates.set(p.name, results);
              working = i;
              break;
            }
          } catch {
            // This shop platform has no search at this URL; try the next pattern.
          }
        }
      }
      const prompt = buildProductPageMatchPrompt({
        brandName: brief.brand.name,
        products: needSearch.map((p) => ({ name: p.name, notes: p.notes, candidates: candidates.get(p.name) ?? [] })),
      });
      if ([...candidates.values()].some((c) => c.length)) {
        const res = await ai.structured({ purpose: 'kit.match', schema: ProductPageMatchModelSchema, schemaName: 'product_pages', system: prompt.system, input: prompt.input, model: 'text' });
        calls.push(res.call);
        for (const m of res.data.matches) {
          // Only URLs that were really among the results: a model must not invent a page.
          const known = candidates.get(m.product)?.some((c) => c.url === m.url);
          if (pages.has(m.product) && m.url && known) pages.set(m.product, m.url);
        }
      }
    }

    const products: CollectBrandKitResult['products'] = brief.products.map((p) => ({ name: p.name, url: pages.get(p.name) ?? null, imageFile: p.imageFile }));
    for (const p of brief.products) {
      if (!todo.some((t) => t.name === p.name)) {
        items.push({ kind: 'product', product: p.name, file: `products/${p.imageFile}`, status: 'kept', sourceUrl: null, pageUrl: pages.get(p.name) ?? null, note: checked.get(p.name) ?? 'already in the brand kit' });
      }
    }
    for (const p of todo) {
      const pageUrl = pages.get(p.name) ?? null;
      const own = rejected.has(p.name) ? `Your photo ${p.imageFile} looks like a different product (${rejected.get(p.name)}). ` : '';
      if (rejected.has(p.name)) products[p.index]!.imageFile = null;
      if (!pageUrl) {
        items.push({ kind: 'product', product: p.name, file: null, status: 'not_found', sourceUrl: null, pageUrl: null, note: `${own}No product page found on the website.` });
        continue;
      }
      let html = '';
      try {
        html = await page(pageUrl);
      } catch (err) {
        items.push({ kind: 'product', product: p.name, file: null, status: 'not_found', sourceUrl: null, pageUrl, note: `${own}Product page not reachable: ${(err as Error).message}` });
        continue;
      }
      const candidates = (await Promise.all(findProductImages(html, pageUrl).map(image))).filter((c): c is Downloaded => c !== null);
      const { chosen, reason } = await pick('product', candidates, p.name, p.index);
      const out = products[p.index]!;
      if (chosen) {
        const file = productFileName(p.name);
        writeFileSync(path.join(kitDir, 'products', file), chosen.png);
        out.imageFile = file;
        sources.push({ file: `products/${file}`, sourceUrl: chosen.url, pageUrl, retrievedAt: now(), checkedBy: `vision model (kit.product.p${p.index + 1})`, note: reason });
      }
      items.push({ kind: 'product', product: p.name, file: chosen ? `products/${out.imageFile}` : null, status: chosen ? 'collected' : 'not_found', sourceUrl: chosen?.url ?? null, pageUrl, note: `${own}${reason}` });
    }

    if (sources.length) {
      const file = path.join(kitDir, KIT_SOURCES_FILE);
      const previous: KitSource[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as KitSource[]) : [];
      const merged = [...previous.filter((s) => !sources.some((n) => n.file === s.file)), ...sources];
      writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
    }
    return { items, products, calls };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Writes the collected product pages and photo files into brief YAML (camelCase or snake_case keys). */
export function applyCollectedToYaml(yaml: string, products: CollectBrandKitResult['products']): string {
  const header = yaml.match(/^(#.*\n)+/)?.[0] ?? '';
  const raw = parseYaml(yaml) as { products?: Record<string, unknown>[] };
  for (const p of raw.products ?? []) {
    const found = products.find((x) => x.name === p.name);
    if (!found) continue;
    if (found.url) p.url = found.url;
    if (found.imageFile) {
      delete p.image_file;
      p.imageFile = found.imageFile;
    }
  }
  return `${header}${toYaml(raw, { lineWidth: 0 })}`;
}
