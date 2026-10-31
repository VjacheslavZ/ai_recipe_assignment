import { isPriceUsable } from '../prompts/plan.js';
import type { BrandAnalysis, Fact, ProductFact } from '../schemas/analysis.js';
import type { BriefArtifact } from '../schemas/brief.js';
import type { ContentPlan } from '../schemas/plan.js';
import type { Review } from '../schemas/review.js';

const link = (s: string | null) => (!s ? '—' : /^https?:\/\//.test(s) ? `[${s}](${s})` : `\`${s}\``);
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- —');

export function renderBriefMd(b: BriefArtifact): string {
  const k = b.brandKit;
  return `# Brief — ${b.brand.name}

| Field | Value |
| --- | --- |
| Instagram | [${b.brand.instagramHandle}](${b.brand.instagramUrl}) |
| Website | ${link(b.brand.website)} |
| Shops | ${b.brand.shopUrls.map(link).join(', ') || '—'} |
| Market | ${b.market.country}, posts in English |

**Why this brand:** ${b.brand.whyThisBrand}

## Products
${b.products
  .map((p) => `- **${p.name}** — ${link(p.url)} · image: ${p.imageFile ? `\`${p.imageFile}\`` : '—'}${p.notes ? ` · ${p.notes}` : ''}`)
  .join('\n')}

## Audience
${b.audience}

## Goals
${list(b.goals)}

## References
${list(b.references.map((r) => [link(r.url ?? r.file), r.note].filter(Boolean).join(' — ')))}

## Constraints
${list(b.constraints)}
${b.notes ? `\n## Notes\n${b.notes}\n` : ''}
## Brand kit (\`${k.dir}\`)
- Logo: ${k.logo ? `\`${k.logo}\`` : 'missing'}
- Product images: ${k.products.map((p) => `${p.name} ${p.exists ? '✓' : '✗ missing'}`).join('; ')}
- Instagram screenshots: ${k.instagramScreenshots.length ? k.instagramScreenshots.join(', ') : 'none'}
- Fonts: ${k.fonts.length ? k.fonts.join(', ') : 'none (fallback font)'}

## Warnings
${list(b.warnings)}
`;
}

function factRow(f: Fact): string {
  return `| ${f.id} | ${f.statement.replace(/\|/g, '\\|')} | ${link(f.source)} | ${(f.evidence ?? '—').replace(/\|/g, '\\|')} |`;
}

function factTable(facts: Fact[]): string {
  if (!facts.length) return '_None._';
  return `| Id | Statement | Source | Evidence |\n| --- | --- | --- | --- |\n${facts.map(factRow).join('\n')}`;
}

function priceLine(p: ProductFact): string {
  const pr = p.price;
  const amount = pr.amount !== null ? `${pr.amount} ${pr.currency ?? ''}`.trim() : 'no price';
  const who = pr.status === 'confirmed_by_user' ? ` by ${pr.confirmedBy} at ${pr.confirmedAt}` : '';
  return `${amount} — **${pr.status}**${who}${pr.sourceUrl ? ` · ${link(pr.sourceUrl)}` : ''}${pr.retrievedAt ? ` · retrieved ${pr.retrievedAt}` : ''}${pr.note ? ` · ${pr.note}` : ''}`;
}

export function renderAnalysisMd(a: BrandAnalysis): string {
  const all = [...a.brandFacts, ...a.products.flatMap((p) => p.claims)];
  const by = (s: Fact['status']) => all.filter((f) => f.status === s);
  const v = a.visualStyle;
  const c = a.captionStyle;
  return `# Brand analysis — ${a.brandName}

Analysed at ${a.analyzedAt} · Instagram: ${a.instagramAccess === 'screenshots' ? 'analysed via human-provided screenshots' : 'not analysed (unavailable)'}

## Summary
- **Tone:** ${a.tone}
- **Audience:** ${a.audience}
- **Content pillars:** ${a.contentPillars.join('; ') || '—'}
- **Colours:** ${v.colorsHex.join(', ') || '—'}
- **Typography:** ${v.typography}
- **Layout patterns:** ${v.layoutPatterns.join('; ') || '—'}
- **Photo style:** ${v.photoStyle}
- **Product presentation:** ${a.productPresentation}
- **People presentation:** ${a.peoplePresentation}
- **Caption style:** length ${c.length}; emojis ${c.emojis}; hashtags ${c.hashtags}; CTAs ${c.ctaPatterns.join(' | ') || '—'}; language ${c.language}

## Products
${a.products.map((p) => `### ${p.name}\n- Page: ${link(p.url)}\n- Price: ${priceLine(p)}\n- Price usable in posts: ${isPriceUsable(p.price.status) ? 'yes' : 'no'}\n- Claims on the official page: ${p.claims.length ? p.claims.map((f) => f.id).join(', ') : 'none'}`).join('\n\n')}

## Verified
${factTable(by('verified'))}

## Assumptions
${factTable(by('assumption'))}

## Unavailable
${factTable(by('unavailable'))}

### Sources that could not be accessed
${list(a.sourcesUnavailable.map((s) => `${link(s.source)} — ${s.reason}`))}

## Sources used
${list(a.sourcesUsed.map((s) => `${link(s.source)}${s.title ? ` — ${s.title}` : ''} (${s.kind})`))}
`;
}

export function renderPlanMd(plan: ContentPlan, analysis: BrandAnalysis, fixes: string[] = []): string {
  const facts = new Map([...analysis.brandFacts, ...analysis.products.flatMap((p) => p.claims)].map((f) => [f.id, f]));
  const posts = plan.posts.map((p) => {
    const slides = p.slides
      .map((s) => {
        const sub = s.subtext ? `\n   - Subtext: ${s.subtext}` : '';
        return `${s.index}. **${s.role}** — ${s.headline}${sub}
   - Product: ${s.productName ?? '—'}${s.showPrice ? ' · shows price' : ''} · layout \`${s.layout}\` · colours ${s.brandColorsHex.join(', ') || '—'}
   - Background prompt: ${s.backgroundPrompt}`;
      })
      .join('\n');
    const usedFacts = p.factIds.map((id) => `${id}: ${facts.get(id)?.statement ?? '?'}`);
    return `## Post ${p.number} — ${p.format} · ${p.goal}

**Concept:** ${p.concept}

**Why it fits the brand:** ${p.rationale}

### ${p.format === 'story' ? 'Frames' : 'Slides'}
${slides}

### Caption
${p.caption}

${p.hashtags.join(' ')}

**CTA:** ${p.cta}

### Facts used
${list(usedFacts)}
`;
  });
  return `# Content plan — ${analysis.brandName}

${plan.summary}

${posts.join('\n')}${fixes.length ? `\n## Automatic fixes applied during validation\n${list(fixes)}\n` : ''}`;
}

/** `04_create/POSTS.md`: the finished posts 1–3 with slides in order, format, goal, rationale and copy. */
export function renderPostsMd(
  plan: ContentPlan,
  captions: { post: number; slides: string[]; instagramText: string }[],
): string {
  const posts = plan.posts.map((p) => {
    const c = captions.find((x) => x.post === p.number);
    const slides = (c?.slides ?? []).map((file, i) => `![Post ${p.number} — slide ${i + 1}](${file})`).join('\n');
    return `## Post ${p.number} — ${p.format} · ${p.goal}

**Concept:** ${p.concept}

**Why it fits the brand:** ${p.rationale}

${slides}

### Caption (ready to paste)
\`\`\`
${c?.instagramText ?? p.caption}
\`\`\`
`;
  });
  return `# Finished posts

${plan.summary}

${posts.join('\n')}`;
}

/** `05_review/review.md`: QA scores per slide (all attempts), caption fact check and open items. */
export function renderReviewMd(review: Review, plan: ContentPlan): string {
  const posts = plan.posts.map((p) => {
    const slides = review.slides
      .filter((s) => s.post === p.number)
      .map((s) => {
        const attempts = s.attempts
          .map((a, i) => {
            const scores = Object.entries(a.scores).map(([k, v]) => `${k} ${v.score}/5`).join(' · ');
            const issues = a.issues.length ? `\n    - Issues: ${a.issues.join('; ')}` : '';
            return `  - ${i === s.chosen ? '**chosen** ' : ''}attempt ${a.attempt}: **${a.score}/10** (${scores}) — \`${a.file}\`${issues}`;
          })
          .join('\n');
        return `- Slide ${s.slide}: ${s.passed ? '✅ passed' : '⚠️ below threshold'}\n${attempts}`;
      })
      .join('\n');
    const c = review.captions.find((x) => x.post === p.number);
    const claims = c?.claims.length
      ? c.claims.map((cl) => `  - ${cl.supported ? '✅' : '❌'} "${cl.text}"${cl.factId ? ` — ${cl.factId}` : ''}`).join('\n')
      : '  - (no factual claims)';
    const problems = [...(c?.languageIssues ?? []).map((x) => `language: ${x}`), ...(c?.codeIssues ?? [])];
    return `## Post ${p.number} — ${p.format} · ${p.goal}

### Slides
${slides}

### Caption fact check: ${c?.passed ? '✅ ok' : '⚠️ needs fix'}
${claims}${problems.length ? `\n${list(problems)}` : ''}
`;
  });
  return `# QA review

Threshold ${review.threshold}/10 · max ${review.maxRegenerations} regeneration(s) per slide · overall: ${review.passed ? '✅ passed' : '⚠️ not passed'}

## Needs human attention
${review.needsHumanAttention.length ? list(review.needsHumanAttention) : '- nothing'}

${posts.join('\n')}`;
}
