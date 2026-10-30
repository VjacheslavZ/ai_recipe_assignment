import type { BrandAnalysis, Fact } from '../schemas/analysis.js';
import type { PostPlan, SlidePlan } from '../schemas/plan.js';
import { isPriceUsable } from './plan.js';
import { bullets, sections, type BuiltPrompt } from './shared.js';

export const REVIEW_PROMPT_VERSION = 'review@1';

/** Stage 05 — vision QA of one finished slide against the plan and the brand analysis. */
export function buildSlideReviewPrompt(opts: {
  analysis: BrandAnalysis;
  post: PostPlan;
  slide: SlidePlan;
  hasProductReference: boolean;
}): BuiltPrompt {
  const { analysis, post, slide, hasProductReference } = opts;
  const system = sections(
    `You are a strict art director reviewing a finished Instagram slide for ${analysis.brandName} before it is published.`,
    `## How the slide was made
The background was AI-generated without product or text. The real product photo, the real logo and the headline were composited on top. Judge the result as a viewer would see it on a phone.`,
    `## Rules
${bullets([
  'Score each criterion from 1 to 5 and give one concrete reason based on what you actually see.',
  'Be critical: 5 means ready to publish as is; 3 means noticeable problems; 1 means unusable.',
  'Report every visible problem in "issues" (e.g. low contrast, text over a busy area, product looks pasted in, garbled or extra text in the background, wrong diacritics).',
  'If the generated background causes a problem (busy area behind the text, unwanted objects, text-like shapes, wrong mood), write a short instruction for regenerating it in "backgroundFix"; otherwise null.',
  hasProductReference
    ? 'The second image is the reference product photo: compare shape, colours, label and logo with the product on the slide.'
    : 'No product reference is attached; score productAccuracy 5 if the slide has no product, otherwise judge whether the product looks undistorted.',
])}`,
  );
  const input = sections(
    `## Brand look (from the analysis)
- Colours: ${analysis.visualStyle.colorsHex.join(', ')}
- Photo style: ${analysis.visualStyle.photoStyle}
- Typography: ${analysis.visualStyle.typography}`,
    `## This slide
- Post ${post.number} (${post.format}), goal: ${post.goal}; slide ${slide.index}, role: ${slide.role}
- Planned headline (Croatian): "${slide.headlineHr}"${slide.subtextHr ? `\n- Planned subtext (Croatian): "${slide.subtextHr}"` : ''}
- Product: ${slide.productName ?? 'none'}; layout: ${slide.layout}; price shown: ${slide.showPrice ? 'yes' : 'no'}`,
    'The first attached image is the finished slide.',
  );
  return { system, input };
}

function factLine(f: Fact): string {
  return `- [${f.id}] ${f.statement}${f.source ? ` (source: ${f.source})` : ''}`;
}

/** Stage 05 — fact check of one caption: every factual claim must be backed by a verified fact. */
export function buildCaptionReviewPrompt(opts: { analysis: BrandAnalysis; post: PostPlan; instagramText: string }): BuiltPrompt {
  const { analysis, post, instagramText } = opts;
  const verified = [...analysis.brandFacts, ...analysis.products.flatMap((p) => p.claims)].filter((f) => f.status === 'verified');
  const prices = analysis.products
    .filter((p) => isPriceUsable(p.price.status) && p.price.amount !== null)
    .map((p) => `- ${p.name}: ${p.price.amount} ${p.price.currency ?? 'EUR'} (${p.price.status})`);
  const system = sections(
    `You are a fact checker for ${analysis.brandName}'s Instagram captions (Croatian). Nothing may be published that the brand cannot back up.`,
    `## Task
List every factual claim in the caption (product properties, ingredients, effects, prices, discounts, awards, statements attributed to people). For each, give the id of the verified fact that supports it, or null and supported=false. Opinions, questions, invitations and CTAs are not claims. Also list Croatian spelling or grammar problems.`,
    `## Rules
${bullets([
  'Only the verified facts and usable prices listed below count as support. General knowledge does not.',
  'A price is supported only if it matches a usable price exactly.',
  'verdict is "needs_fix" if any claim is unsupported or there is a language problem; otherwise "ok".',
])}`,
  );
  const input = sections(
    `## Caption of post ${post.number} (${post.format}, goal: ${post.goal})
"""
${instagramText}
"""`,
    `## Verified facts
${verified.length ? verified.map(factLine).join('\n') : '- (none)'}`,
    `## Usable prices
${prices.length ? prices.join('\n') : '- (none — any price in the caption is unsupported)'}`,
  );
  return { system, input };
}
