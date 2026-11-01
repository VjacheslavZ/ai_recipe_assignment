import type { BrandAnalysis, Fact } from '../schemas/analysis.js';
import type { Brief } from '../schemas/brief.js';
import { bullets, sections, type BuiltPrompt } from './shared.js';

export const PLAN_PROMPT_VERSION = 'plan@4';

export interface PlanPromptInput {
  brief: Brief;
  analysis: BrandAnalysis;
}

/** Prices a post may show: verified on the official site or confirmed by the user (ADR-018). */
export function isPriceUsable(status: string): boolean {
  return status === 'verified' || status === 'confirmed_by_user';
}

function factLine(f: Fact): string {
  return `- [${f.id}] ${f.statement}${f.source ? ` (source: ${f.source})` : ''}`;
}

/** Stage 03 — plan three Instagram posts from the brief and the merged brand analysis. */
export function buildPlanPrompt({ brief, analysis }: PlanPromptInput): BuiltPrompt {
  const system = sections(
    `You are the lead content strategist and copywriter for ${brief.brand.name}'s Instagram (${brief.brand.instagramHandle}).
You plan posts that a designer will produce by compositing REAL product photos and the real logo onto AI-generated backgrounds, with your headlines set as text on top.`,
    `## Task
Plan exactly three Instagram posts, numbered 1, 2 and 3. For each choose a goal, a format and a concept, write the on-image copy for every slide/frame, the caption and a short rationale.`,
    `## Formats
- carousel: 3–6 slides (4:5), a story arc (hook → value → product → CTA).
- single: exactly 1 image (4:5).
- story: 2–3 vertical frames (9:16), a quick sequence.
Prefer a mix of one carousel, one single and one story unless the brief clearly calls for something else. Map the brief's goals onto the posts (goal values: education, engagement, saves, product_intro, purchase_intent).`,
    `## Rules
${bullets([
  'Facts: product properties, numbers and brand claims may only come from the VERIFIED facts listed in the input. List the ids of every fact a post relies on in "factIds"; only ids of verified facts and verified claims exist. Assumptions are context only (they have no ids) — never state them as claims.',
  'No invented properties, health promises, discounts, prices or quotes. If no verified fact supports a claim, do not make it; write benefit-neutral, inviting copy instead.',
  'Prices: set "showPrice": true only for products whose price is marked "price may be shown". Never write a price amount in headlines or captions — the designer renders it from verified data.',
  '"productName" must be exactly one of the product names listed in the input, or null for a slide without a product. Use layout "text-only" when productName is null.',
  'People: no recurring people or influencers. Backgrounds may include at most anonymous, non-identifiable people (no faces).',
  '"backgroundPrompt": an English prompt for an image model describing only the scene/surface/lighting/mood in the brand\'s photo style and colours. It must NOT contain the product, packaging, any text, letters, logos or faces. Leave clear empty space where the product and headline will be placed (match the layout).',
  'Copy: English, natural and idiomatic social-media copy matching the brand tone and caption style from the analysis (even when the account posts in another language). Headlines short (max ~7 words), subtext max ~15 words.',
  'Captions: follow the analysed caption style (length, emojis, hashtags, CTA patterns). 3–8 relevant hashtags including the brand hashtag if the analysis shows one.',
  '"brandColorsHex": pick from the analysed brand colours.',
  'Rationale: 2–4 sentences explaining why the concept fits this brand and audience, referencing specific analysis findings (tone, pillars, visual style) and fact ids.',
])}`,
    `## Output
Return JSON matching the provided schema: a short "summary" and "posts" with exactly three entries (numbers 1, 2, 3), slides indexed from 1 in display order.`,
  );

  const verified = analysis.brandFacts.filter((f) => f.status === 'verified');
  const assumptions = analysis.brandFacts.filter((f) => f.status === 'assumption');

  const products = analysis.products
    .map((p) => {
      const brief_ = brief.products.find((b) => b.name === p.name);
      const price = isPriceUsable(p.price.status)
        ? `price may be shown (${p.price.status})`
        : `price must NOT be shown (${p.price.status})`;
      const claims = p.claims.filter((c) => c.status === 'verified');
      return sections(
        `### ${p.name}`,
        `Page: ${p.url ?? 'unknown'} · ${price}${brief_?.imageFile ? ' · real product photo available' : ' · no product photo yet'}`,
        brief_?.notes ? `Brief notes: ${brief_.notes}` : null,
        claims.length ? `Verified claims:\n${claims.map(factLine).join('\n')}` : 'Verified claims: none — do not state product properties.',
      );
    })
    .join('\n\n');

  const v = analysis.visualStyle;
  const c = analysis.captionStyle;
  const input = sections(
    `# Brief
Brand: ${brief.brand.name} — ${brief.brand.website} — ${brief.brand.instagramHandle}
Audience: ${brief.audience}
Goals:\n${bullets(brief.goals)}
Constraints:\n${bullets(brief.constraints)}${brief.notes ? `\nNotes: ${brief.notes}` : ''}${
      brief.references.length
        ? `\nReferences:\n${bullets(brief.references.map((r) => [r.url ?? r.file, r.note].filter(Boolean).join(' — ')))}`
        : ''
    }`,
    `# Brand analysis
Tone: ${analysis.tone}
Audience (observed): ${analysis.audience}
Content pillars: ${analysis.contentPillars.join('; ') || 'unknown'}
Colours: ${v.colorsHex.join(', ') || 'unknown — use neutral black/white'}
Typography: ${v.typography}
Layout patterns: ${v.layoutPatterns.join('; ') || 'unknown'}
Photo style: ${v.photoStyle}
Product presentation: ${analysis.productPresentation}
People presentation: ${analysis.peoplePresentation}
Caption style: length ${c.length}; emojis ${c.emojis}; hashtags ${c.hashtags}; CTAs ${c.ctaPatterns.join(' | ') || 'unknown'}; language ${c.language}`,
    `# Verified brand facts (usable as claims)\n${verified.map(factLine).join('\n') || '(none)'}`,
    // No ids: an id invites the model to cite an assumption in factIds, which validation rejects.
    assumptions.length ? `# Assumptions (context only, not claims)\n${assumptions.map((f) => `- ${f.statement}`).join('\n')}` : null,
    `# Products (use these exact names)\n${products}`,
  );

  return { system, input };
}
