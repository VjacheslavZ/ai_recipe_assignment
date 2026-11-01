import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Input files of a run that is being prepared on the Start a run page (ADR-033): the logo,
 * product photos and Instagram screenshots are uploaded (or collected from the brand's site)
 * into a folder of their own, shown as previews, and moved into the run when it starts.
 * Nothing is kept between runs.
 */

export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** Upload field → place in the kit folder. */
export const KIT_FIELDS = ['logo', 'products', 'screenshots'] as const;
export type KitField = (typeof KIT_FIELDS)[number];

/** What a kit folder holds, as paths relative to it (`logo.png`, `products/…`, `instagram/…`). */
export interface KitFiles {
  logo: string | null;
  products: string[];
  instagram: string[];
}

/** Keeps only the file name and a safe character set. */
export function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.-]+/g, '_');
}

/**
 * Copies a folder file by file. fs.cpSync fails with EACCES when the target is a Docker Desktop
 * bind mount (runs/ in compose.yaml), while plain copyFileSync works there.
 */
export function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile() && !entry.name.startsWith('.')) copyFileSync(src, dest);
  }
}

const images = (dir: string, sub: string) =>
  existsSync(path.join(dir, sub))
    ? readdirSync(path.join(dir, sub))
        .filter((f) => IMAGE_EXT.test(f) && !f.startsWith('.'))
        .sort()
        .map((f) => `${sub}/${f}`)
    : [];

export function listKit(dir: string): KitFiles {
  return { logo: existsSync(path.join(dir, 'logo.png')) ? 'logo.png' : null, products: images(dir, 'products'), instagram: images(dir, 'instagram') };
}

export class KitStore {
  constructor(private readonly root: string) {}

  create(): string {
    const id = randomBytes(12).toString('hex');
    mkdirSync(path.join(this.root, id), { recursive: true });
    return id;
  }

  /** The folder of a kit, or null for an unknown or malformed id. */
  dir(id: string | undefined): string | null {
    if (!id || !/^[a-f0-9]{24}$/.test(id)) return null;
    const dir = path.join(this.root, id);
    return existsSync(dir) ? dir : null;
  }

  /** Saves an upload; a new logo replaces the old one (it is always read as `logo.png`). */
  add(dir: string, field: KitField, filename: string, data: Buffer): void {
    const target = field === 'logo' ? path.join(dir, 'logo.png') : path.join(dir, field === 'products' ? 'products' : 'instagram', safeName(filename));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  /** Removes one file given as a path relative to the kit; false when it is not a kit image. */
  remove(dir: string, rel: string): boolean {
    const file = this.file(dir, rel);
    if (!file) return false;
    rmSync(file);
    return true;
  }

  /** Absolute path of an image inside the kit, or null (no escaping the folder). */
  file(dir: string, rel: string): string | null {
    const file = path.resolve(dir, rel);
    return file.startsWith(dir + path.sep) && IMAGE_EXT.test(file) && existsSync(file) ? file : null;
  }

  /** Deletes kits of pages that were left without starting a run. */
  cleanup(maxAgeMs: number): void {
    if (!existsSync(this.root)) return;
    for (const id of readdirSync(this.root)) {
      const dir = path.join(this.root, id);
      if (Date.now() - statSync(dir).mtimeMs > maxAgeMs) rmSync(dir, { recursive: true, force: true });
    }
  }
}
