import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { StageDefinition } from '../pipeline/types.js';
import {
  BriefValidationError,
  normalizeBrief,
  type Brief,
  type BriefArtifact,
  type BrandKitStatus,
} from '../schemas/brief.js';
import { renderBriefMd } from './markdown.js';

export const BRIEF_INPUT_FILE = 'brief.input.yaml';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => pattern.test(f) && !f.startsWith('.'))
    .sort();
}

/** Lists Instagram screenshots in `brand_kit/<slug>/instagram/` (sorted, images only). */
export function listInstagramScreenshots(brandKitDir: string, slug: string): string[] {
  return listFiles(path.join(brandKitDir, slug, 'instagram'), IMAGE_EXT);
}

/** Checks which brand-kit files exist. Missing files are reported, never fatal. */
export function checkBrandKit(brandKitDir: string, brief: Brief): BrandKitStatus {
  const dir = path.join(brandKitDir, brief.brand.slug);
  const missing: string[] = [];

  const logo = existsSync(path.join(dir, 'logo.png')) ? 'logo.png' : null;
  if (!logo) missing.push(`${brief.brand.slug}/logo.png`);

  const products = brief.products.map((p) => {
    const exists = p.imageFile ? existsSync(path.join(dir, 'products', p.imageFile)) : false;
    if (!exists) missing.push(`${brief.brand.slug}/products/${p.imageFile ?? `<image for "${p.name}">`}`);
    return { name: p.name, imageFile: p.imageFile, exists };
  });

  const instagramScreenshots = listInstagramScreenshots(brandKitDir, brief.brand.slug);
  if (!instagramScreenshots.length) missing.push(`${brief.brand.slug}/instagram/*.png (screenshots)`);

  return { dir, logo, products, instagramScreenshots, fonts: listFiles(path.join(dir, 'fonts'), FONT_EXT), missing };
}

/** Parses brief YAML text; YAML syntax errors become a `BriefValidationError` too. */
export function parseBriefYaml(text: string): { brief: Brief; warnings: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new BriefValidationError([`YAML syntax: ${(err as Error).message}`]);
  }
  return normalizeBrief(raw);
}

export const briefStage: StageDefinition = {
  no: 1,
  id: 'brief',
  title: 'Brief & inputs',
  async run(ctx) {
    const inputPath = ctx.store.path('brief', BRIEF_INPUT_FILE);
    if (!existsSync(inputPath)) throw new Error(`Brief input not found: ${inputPath}`);

    const { brief, warnings } = parseBriefYaml(readFileSync(inputPath, 'utf8'));
    const brandKit = checkBrandKit(ctx.brandKitDir, brief);
    const allWarnings = [...warnings, ...brandKit.missing.map((m) => `brand kit: missing ${m}`)];
    for (const w of allWarnings) ctx.log(`warning: ${w}`);

    const artifact: BriefArtifact = { ...brief, brandKit, warnings: allWarnings };
    ctx.store.writeJson('brief', 'brief.json', artifact);
    ctx.store.writeText('brief', 'brief.md', renderBriefMd(artifact));
    ctx.log(`brief: ${brief.brand.name}, ${brief.products.length} product(s), ${brandKit.instagramScreenshots.length} screenshot(s)`);
  },
};
