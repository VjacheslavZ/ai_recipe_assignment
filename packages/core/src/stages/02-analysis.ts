import path from 'node:path';
import type { Source } from '../ai/types.js';
import type { PendingQuestion, StageDefinition } from '../pipeline/types.js';
import {
  ANALYSIS_INSTAGRAM_PROMPT_VERSION,
  ANALYSIS_SITE_PROMPT_VERSION,
  buildAnalysisInstagramPrompt,
  buildAnalysisSitePrompt,
} from '../prompts/index.js';
import { slugify } from '../run/store.js';
import {
  BrandAnalysisSchema,
  HEX_COLOR,
  InstagramAnalysisModelSchema,
  SiteAnalysisModelSchema,
  type BrandAnalysis,
  type Fact,
  type InstagramAnalysisModel,
  type ModelFact,
  type PriceConfirmation,
  type ProductFact,
  type SiteAnalysisModel,
} from '../schemas/analysis.js';
import { BriefArtifactSchema, brandDomains, type Brief } from '../schemas/brief.js';
import { listInstagramScreenshots } from './01-brief.js';
import { renderAnalysisMd } from './markdown.js';

/** Vision input is capped to keep the call cheap; the README asks for 6–10 screenshots. */
const MAX_SCREENSHOTS = 10;

export const INSTAGRAM_NO_SCREENSHOTS_REASON = 'no screenshots provided; Instagram blocks automated access';

export interface MergeInput {
  brief: Brief;
  site: SiteAnalysisModel;
  siteSources: Source[];
  instagram: InstagramAnalysisModel | null;
  instagramSources?: Source[];
  /** Screenshot file names actually sent to the vision model. */
  screenshots: string[];
  /** ISO timestamp of the research; used as retrievedAt for web facts. */
  now: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function isOnDomains(url: string | null, domains: string[]): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function normalizeHex(colors: string[]): string[] {
  const out = colors
    .map((c) => c.trim().toUpperCase())
    .map((c) => (c.startsWith('#') ? c : `#${c}`))
    .map((c) => (/^#[0-9A-F]{3}$/.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c))
    .filter((c) => HEX_COLOR.test(c));
  return [...new Set(out)];
}

/**
 * Turns a model fact into an artifact fact with a stable id. A "verified" claim is
 * downgraded to "assumption" when its source is missing or (for web facts) not on
 * an official brand domain — the model's own tag is not trusted blindly.
 */
function toFact(
  mf: ModelFact,
  id: string,
  kind: 'web' | 'screenshot',
  ctx: { domains: string[]; screenshots: string[]; now: string },
): Fact {
  let status = mf.status;
  if (status === 'verified') {
    const ok =
      kind === 'web' ? isOnDomains(mf.source, ctx.domains) : !!mf.source && ctx.screenshots.includes(path.basename(mf.source));
    if (!ok) status = 'assumption';
  }
  const retrievedAt = kind === 'web' && mf.source && status !== 'unavailable' ? ctx.now : null;
  return { id, statement: mf.statement, status, source: mf.source, evidence: mf.evidence, retrievedAt };
}

/** Merges the site and Instagram model outputs into one analysis (no AI call). */
export function mergeAnalysis(input: MergeInput): BrandAnalysis {
  const { brief, site, instagram, screenshots, now } = input;
  const domains = brandDomains(brief);
  const fctx = { domains, screenshots, now };

  const siteFacts = site.brandFacts.map((f, i) => toFact(f, `F-SITE-${pad(i + 1)}`, 'web', fctx));
  const igFacts = (instagram?.observations ?? []).map((f, i) => toFact(f, `F-IG-${pad(i + 1)}`, 'screenshot', fctx));

  const sourcesUnavailable = [...site.sourcesUnavailable];

  const products: ProductFact[] = brief.products.map((bp, i) => {
    const mp = site.products.find((p) => normName(p.briefProductName) === normName(bp.name));
    if (!mp) {
      sourcesUnavailable.push({ source: bp.url ?? bp.name, reason: `product "${bp.name}" was not returned by site research` });
      return {
        name: bp.name,
        url: bp.url,
        price: {
          amount: null, currency: null, status: 'pending_confirmation', retrievedAt: null,
          sourceUrl: null, confirmedBy: null, confirmedAt: null, note: 'product not found by site research',
        },
        claims: [],
      };
    }
    const url = isOnDomains(mp.url, domains) ? mp.url : bp.url;
    const p = mp.price;
    const amount = p.amount !== null && p.amount > 0 ? p.amount : null;
    const officialSource = isOnDomains(p.sourceUrl, domains);
    const verified = amount !== null && officialSource && p.confident && !!p.currency;
    const reasons = [
      amount === null && 'price not found',
      amount !== null && !p.sourceUrl && 'no source URL',
      p.sourceUrl && !officialSource && 'source is not an official brand page',
      !p.confident && 'model not confident',
      amount !== null && !p.currency && 'currency missing',
    ].filter(Boolean);
    return {
      name: bp.name,
      url,
      price: {
        amount,
        currency: p.currency ? p.currency.toUpperCase() : null,
        status: verified ? 'verified' : 'pending_confirmation',
        retrievedAt: amount !== null ? now : null,
        sourceUrl: p.sourceUrl,
        confirmedBy: null,
        confirmedAt: null,
        note: verified ? p.priceText : [p.uncertaintyNote, ...reasons].filter(Boolean).join('; ') || null,
      },
      claims: mp.claims.map((c, j) => toFact(c, `F-P${i + 1}-${pad(j + 1)}`, 'web', fctx)),
    };
  });

  // Direct Instagram access is always unavailable (ADR-005); screenshots are the workaround.
  sourcesUnavailable.push({
    source: brief.brand.instagramUrl,
    reason: instagram
      ? `Instagram blocks automated access; analysed via ${screenshots.length} human-provided screenshot(s)`
      : INSTAGRAM_NO_SCREENSHOTS_REASON,
  });
  sourcesUnavailable.push(...(instagram?.screenshotsUnreadable ?? []));

  const sourcesUsed = new Map<string, BrandAnalysis['sourcesUsed'][number]>();
  for (const s of [...input.siteSources, ...(input.instagramSources ?? [])]) {
    sourcesUsed.set(s.url, { source: s.url, title: s.title ?? null, kind: 'web' });
  }
  for (const f of [...siteFacts, ...products.flatMap((p) => p.claims)]) {
    if (f.source && f.status !== 'unavailable' && !sourcesUsed.has(f.source)) {
      sourcesUsed.set(f.source, { source: f.source, title: null, kind: 'web' });
    }
  }
  for (const p of products) {
    if (p.price.sourceUrl && !sourcesUsed.has(p.price.sourceUrl)) {
      sourcesUsed.set(p.price.sourceUrl, { source: p.price.sourceUrl, title: null, kind: 'web' });
    }
  }
  if (instagram) for (const s of screenshots) sourcesUsed.set(s, { source: s, title: null, kind: 'screenshot' });

  const unknown = 'unknown — no Instagram screenshots provided';
  return BrandAnalysisSchema.parse({
    brandName: brief.brand.name,
    analyzedAt: now,
    instagramAccess: instagram ? 'screenshots' : 'unavailable',
    tone: instagram?.tone ?? site.toneSignals ?? unknown,
    audience: instagram?.audience ?? site.audienceSignals ?? brief.audience,
    contentPillars: instagram?.contentPillars ?? [],
    visualStyle: {
      colorsHex: normalizeHex(instagram?.visualStyle.colorsHex ?? []),
      typography: instagram?.visualStyle.typography ?? unknown,
      layoutPatterns: instagram?.visualStyle.layoutPatterns ?? [],
      photoStyle: instagram?.visualStyle.photoStyle ?? unknown,
    },
    productPresentation: instagram?.productPresentation ?? unknown,
    peoplePresentation: instagram?.peoplePresentation ?? unknown,
    captionStyle: instagram?.captionStyle ?? {
      length: unknown, emojis: unknown, hashtags: unknown, ctaPatterns: [], language: 'unknown (posts are written in English)',
    },
    brandFacts: [...siteFacts, ...igFacts],
    products,
    sourcesUsed: [...sourcesUsed.values()],
    sourcesUnavailable,
  });
}

/** Parses a user-typed price like "24,90", "24.90 €" or "EUR 24.9". */
export function parsePriceAnswer(answer: string): number | null {
  const m = /(\d+(?:[.,]\d{1,2})?)/.exec(answer.replace(/\s/g, ''));
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ADR-018: every price that is not verified is put to the user. An answer makes it
 * `confirmed_by_user` (who/when recorded); no answer means the price is `omitted`.
 */
export async function confirmPrices(
  analysis: BrandAnalysis,
  ask: (q: PendingQuestion) => Promise<string | null>,
  log: (msg: string) => void,
  now: () => string = () => new Date().toISOString(),
): Promise<{ analysis: BrandAnalysis; confirmations: PriceConfirmation[] }> {
  const confirmations: PriceConfirmation[] = [];
  const products: ProductFact[] = [];

  for (const product of analysis.products) {
    if (product.price.status !== 'pending_confirmation') {
      products.push(product);
      continue;
    }
    const questionId = `price:${slugify(product.name)}`;
    const reason = product.price.note ?? 'price not verified';
    const suggestedAnswer = product.price.amount !== null ? String(product.price.amount) : null;
    const answer = await ask({
      id: questionId,
      question: `Current price of ${product.name} (EUR)?`,
      context: [product.url ?? product.price.sourceUrl, reason].filter(Boolean).join(' — '),
      ...(suggestedAnswer ? { suggestedAnswer } : {}),
    });
    const at = now();
    const amount = answer?.trim() ? parsePriceAnswer(answer) : null;

    if (amount !== null) {
      products.push({
        ...product,
        price: {
          ...product.price,
          amount,
          currency: 'EUR',
          status: 'confirmed_by_user',
          sourceUrl: product.price.sourceUrl ?? product.url,
          confirmedBy: 'user',
          confirmedAt: at,
          note: `confirmed by user (was: ${reason})`,
        },
      });
      log(`price: ${product.name} confirmed by user: ${amount} EUR`);
    } else {
      const why = answer?.trim() ? `unparseable answer "${answer.trim()}"` : 'no answer';
      products.push({
        ...product,
        price: { ...product.price, amount: null, status: 'omitted', confirmedBy: null, confirmedAt: null, note: `omitted: ${why} (was: ${reason})` },
      });
      log(`price: ${product.name} omitted (${why})`);
    }
    confirmations.push({
      questionId,
      product: product.name,
      url: product.url,
      reason,
      suggestedAnswer,
      answer: answer ?? null,
      status: amount !== null ? 'confirmed_by_user' : 'omitted',
      confirmedBy: amount !== null ? 'user' : null,
      answeredAt: at,
    });
  }
  return { analysis: { ...analysis, products }, confirmations };
}

export const analysisStage: StageDefinition = {
  no: 2,
  id: 'analysis',
  title: 'Brand analysis',
  async run(ctx) {
    const brief = ctx.store.readJson('brief', 'brief.json', BriefArtifactSchema);
    const now = new Date().toISOString();
    const allowedDomains = brandDomains(brief);
    const prompts: { purpose: string; version: string; system: string; input: string; images?: string[] }[] = [];

    const sitePrompt = buildAnalysisSitePrompt({ brief, allowedDomains, today: now.slice(0, 10) });
    prompts.push({ purpose: 'analysis.site', version: ANALYSIS_SITE_PROMPT_VERSION, ...sitePrompt });
    ctx.log(`analysis.site: researching ${allowedDomains.join(', ')}`);
    const site = await ctx.ai.structured({
      purpose: 'analysis.site',
      schema: SiteAnalysisModelSchema,
      schemaName: 'site_analysis',
      ...sitePrompt,
      webSearch: { allowedDomains, country: 'HR' },
      model: 'text',
    });

    const screenshots = listInstagramScreenshots(ctx.kitDir).slice(0, MAX_SCREENSHOTS);
    let instagram: { data: InstagramAnalysisModel; sources: Source[] } | null = null;
    if (screenshots.length) {
      const igDir = path.join(ctx.kitDir, 'instagram');
      const images = screenshots.map((f) => path.join(igDir, f));
      const igPrompt = buildAnalysisInstagramPrompt({ brief, screenshotFiles: screenshots });
      prompts.push({ purpose: 'analysis.instagram', version: ANALYSIS_INSTAGRAM_PROMPT_VERSION, ...igPrompt, images: screenshots });
      ctx.log(`analysis.instagram: ${screenshots.length} screenshot(s)`);
      instagram = await ctx.ai.structured({
        purpose: 'analysis.instagram',
        schema: InstagramAnalysisModelSchema,
        schemaName: 'instagram_analysis',
        ...igPrompt,
        images,
        model: 'vision',
      });
    } else {
      ctx.log(`warning: Instagram not analysed — ${INSTAGRAM_NO_SCREENSHOTS_REASON}`);
    }
    ctx.store.writeJson('analysis', 'prompts.json', prompts);

    const merged = mergeAnalysis({
      brief,
      site: site.data,
      siteSources: site.sources,
      instagram: instagram?.data ?? null,
      instagramSources: instagram?.sources ?? [],
      screenshots: instagram ? screenshots : [],
      now,
    });
    const { analysis, confirmations } = await confirmPrices(merged, ctx.ask, ctx.log);

    ctx.store.writeJson('analysis', 'analysis.json', BrandAnalysisSchema.parse(analysis));
    ctx.store.writeText('analysis', 'analysis.md', renderAnalysisMd(analysis));
    ctx.store.writeJson('analysis', 'sources.json', {
      sourcesUsed: analysis.sourcesUsed,
      sourcesUnavailable: analysis.sourcesUnavailable,
      apiCitations: { 'analysis.site': site.sources, 'analysis.instagram': instagram?.sources ?? [] },
    });
    ctx.store.writeJson('analysis', 'price_confirmations.json', confirmations);

    const count = (s: string) => analysis.brandFacts.filter((f) => f.status === s).length;
    ctx.log(`analysis: ${count('verified')} verified, ${count('assumption')} assumption(s), ${analysis.sourcesUnavailable.length} unavailable source(s)`);
  },
};
