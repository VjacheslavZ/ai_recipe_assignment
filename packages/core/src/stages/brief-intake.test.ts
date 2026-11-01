import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../ai/mock.js';
import { parseConfig } from '../config.js';
import { briefDraftFixture } from '../fixtures/index.js';
import { parseBriefYaml } from './01-brief.js';
import { draftBrief, draftToBriefInput, slugFromHandle } from './brief-intake.js';

const config = parseConfig({ AI_PROVIDER: 'mock' }, '/tmp');

function kit(files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-kit-'));
  mkdirSync(path.join(dir, 'gymbeamhr', 'products'), { recursive: true });
  for (const f of files) writeFileSync(path.join(dir, 'gymbeamhr', 'products', f), '');
  return dir;
}

describe('draftBrief', () => {
  it('turns the draft into a valid brief and YAML that POST /api/runs accepts', async () => {
    const draftModel = {
      ...briefDraftFixture,
      products: [
        { ...briefDraftFixture.products[0]!, imageFile: 'true-whey.png' },
        { ...briefDraftFixture.products[1]!, imageFile: 'invented.png' },
      ],
    };
    const ai = createMockClient(config, { fixtures: { 'brief.intake': draftModel }, delayMs: 0 });
    const draft = await draftBrief(ai, { text: 'GymBeam posts', brandKitDir: kit(['true-whey.png']) });

    expect(draft.missing).toEqual([]);
    expect(draft.brief?.brand).toMatchObject({ slug: 'gymbeamhr', website: 'https://gymbeam.hr' });
    // A file name the model made up is dropped rather than kept as a broken reference.
    expect(draft.brief?.products.map((p) => p.imageFile)).toEqual(['true-whey.png', null]);
    expect(draft.assumptions[0]?.field).toBe('audience');
    expect(draft.call.purpose).toBe('brief.intake');
    expect(parseBriefYaml(draft.yaml).brief).toEqual(draft.brief);
  });

  it('lists missing required information instead of inventing it', () => {
    const { missing } = draftToBriefInput({
      ...briefDraftFixture,
      brand: { ...briefDraftFixture.brand, website: null, instagramHandle: ' ' },
      products: [],
    });
    expect(missing).toEqual([
      'Instagram account (e.g. @gymbeamhr)',
      'Official website (the only source of product facts and prices)',
      'At least one product to promote',
    ]);
  });

  it('drops shop URLs that repeat the website', () => {
    const { input } = draftToBriefInput({
      ...briefDraftFixture,
      brand: { ...briefDraftFixture.brand, shopUrls: ['https://www.gymbeam.hr/', 'https://shop.example.com'] },
    });
    expect((input.brand as { shopUrls: string[] }).shopUrls).toEqual(['https://shop.example.com']);
  });

  it('derives the brand-kit folder from the Instagram handle', () => {
    expect(slugFromHandle('@GymBeam.HR')).toBe('gymbeam-hr');
    expect(slugFromHandle('gymbeamhr')).toBe('gymbeamhr');
  });
});
