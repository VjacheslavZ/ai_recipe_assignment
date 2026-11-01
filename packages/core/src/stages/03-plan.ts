import type { StageDefinition } from '../pipeline/types.js';
import { PLAN_PROMPT_VERSION, buildPlanPrompt, isPriceUsable } from '../prompts/index.js';
import { BrandAnalysisSchema, HEX_COLOR, type BrandAnalysis } from '../schemas/analysis.js';
import { BriefArtifactSchema } from '../schemas/brief.js';
import {
  ContentPlanModelSchema,
  ContentPlanSchema,
  SLIDE_COUNT,
  type ContentPlan,
  type ContentPlanModel,
} from '../schemas/plan.js';
import { stripEmoji } from '../text.js';
import { renderPlanMd } from './markdown.js';

export class PlanValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Content plan failed validation:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
    this.name = 'PlanValidationError';
  }
}

/**
 * Checks the model's plan against the analysis. Safe problems are fixed and
 * reported in `fixes` (price hidden, slides renumbered, bad colours dropped);
 * anything that would change meaning (unknown product, unverified fact, wrong
 * slide count) throws `PlanValidationError`.
 */
export function validatePlan(raw: ContentPlanModel, analysis: BrandAnalysis): { plan: ContentPlan; fixes: string[] } {
  const violations: string[] = [];
  const fixes: string[] = [];

  const numbers = raw.posts.map((p) => p.number).sort((a, b) => a - b);
  if (raw.posts.length !== 3 || numbers.join(',') !== '1,2,3') {
    violations.push(`expected exactly 3 posts numbered 1, 2, 3; got [${numbers.join(', ')}]`);
  }

  const products = new Map(analysis.products.map((p) => [p.name.trim().toLowerCase(), p]));
  const facts = new Map([...analysis.brandFacts, ...analysis.products.flatMap((p) => p.claims)].map((f) => [f.id, f]));

  const posts = [...raw.posts]
    .sort((a, b) => a.number - b.number)
    .map((post) => {
      const label = `post ${post.number}`;
      const range = SLIDE_COUNT[post.format];
      if (post.slides.length < range.min || post.slides.length > range.max) {
        const want = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
        violations.push(`${label}: ${post.format} needs ${want} slide(s), got ${post.slides.length}`);
      }

      for (const id of post.factIds) {
        const fact = facts.get(id);
        if (!fact) violations.push(`${label}: factId "${id}" does not exist in the analysis`);
        else if (fact.status !== 'verified') violations.push(`${label}: factId "${id}" is "${fact.status}", only verified facts may be used`);
      }

      const sorted = [...post.slides].sort((a, b) => a.index - b.index);
      const slides = sorted.map((slide, i) => {
        const where = `${label} slide ${i + 1}`;
        const s = { ...slide };
        if (s.index !== i + 1) {
          fixes.push(`${where}: index ${s.index} renumbered to ${i + 1}`);
          s.index = i + 1;
        }

        if (s.productName !== null && !s.productName.trim()) s.productName = null;
        if (s.productName !== null) {
          const product = products.get(s.productName.trim().toLowerCase());
          if (!product) {
            violations.push(`${where}: product "${s.productName}" is not in the analysis (known: ${analysis.products.map((p) => p.name).join(', ')})`);
          } else {
            s.productName = product.name;
            if (s.showPrice && !isPriceUsable(product.price.status)) {
              fixes.push(`${where}: showPrice forced to false — price of "${product.name}" is ${product.price.status}`);
              s.showPrice = false;
            }
          }
          if (s.layout === 'text-only') {
            fixes.push(`${where}: layout text-only with a product changed to product-center`);
            s.layout = 'product-center';
          }
        } else {
          if (s.showPrice) {
            fixes.push(`${where}: showPrice forced to false — slide has no product`);
            s.showPrice = false;
          }
          if (s.layout !== 'text-only') {
            fixes.push(`${where}: layout ${s.layout} without a product changed to text-only`);
            s.layout = 'text-only';
          }
        }

        const headline = stripEmoji(s.headline);
        const subtext = s.subtext === null ? null : stripEmoji(s.subtext) || null;
        if (headline !== s.headline || subtext !== s.subtext) {
          fixes.push(`${where}: emoji removed from the slide text (slides cannot render them)`);
          s.headline = headline;
          s.subtext = subtext;
        }

        const colors = s.brandColorsHex.map((c) => c.trim().toUpperCase());
        const valid = colors.filter((c) => HEX_COLOR.test(c));
        if (valid.length !== colors.length) fixes.push(`${where}: dropped invalid colours ${colors.filter((c) => !HEX_COLOR.test(c)).join(', ')}`);
        s.brandColorsHex = [...new Set(valid)];
        return s;
      });

      if (!slides.some((s) => s.productName !== null)) violations.push(`${label}: no slide shows a product; every post needs at least one slide with a productName`);
      return { ...post, slides };
    });

  if (violations.length) throw new PlanValidationError(violations);
  return { plan: ContentPlanSchema.parse({ summary: raw.summary, posts }), fixes };
}

/** Appended to the plan input when the first plan broke the rules. */
export function planCorrectionNote(violations: string[]): string {
  return `# Your previous plan was rejected\nFix these problems and return the whole corrected plan:\n${violations.map((v) => `- ${v}`).join('\n')}`;
}

export const planStage: StageDefinition = {
  no: 3,
  id: 'plan',
  title: 'Content plan',
  async run(ctx) {
    const brief = ctx.store.readJson('brief', 'brief.json', BriefArtifactSchema);
    const analysis = ctx.store.readJson('analysis', 'analysis.json', BrandAnalysisSchema);

    const prompt = buildPlanPrompt({ brief, analysis });
    const prompts = [{ purpose: 'plan', version: PLAN_PROMPT_VERSION, ...prompt }];
    ctx.store.writeJson('plan', 'prompts.json', prompts);

    const ask = (purpose: string, input: string) =>
      ctx.ai.structured({ purpose, schema: ContentPlanModelSchema, schemaName: 'content_plan', system: prompt.system, input, model: 'text' });

    let res = await ask('plan', prompt.input);
    let validated: ReturnType<typeof validatePlan>;
    try {
      validated = validatePlan(res.data, analysis);
    } catch (err) {
      if (!(err instanceof PlanValidationError)) throw err;
      // One correction round: the model gets its rule violations back. A second failure stops the run.
      ctx.log(`plan rejected (${err.violations.join('; ')}) — asking the model to correct it`);
      const retryInput = `${prompt.input}\n\n${planCorrectionNote(err.violations)}`;
      prompts.push({ purpose: 'plan.retry', version: PLAN_PROMPT_VERSION, system: prompt.system, input: retryInput });
      ctx.store.writeJson('plan', 'prompts.json', prompts);
      res = await ask('plan.retry', retryInput);
      validated = validatePlan(res.data, analysis);
    }
    const { plan, fixes } = validated;
    for (const f of fixes) ctx.log(`plan fix: ${f}`);

    ctx.store.writeJson('plan', 'plan.json', plan);
    ctx.store.writeText('plan', 'plan.md', renderPlanMd(plan, analysis, fixes));
    ctx.log(`plan: ${plan.posts.map((p) => `#${p.number} ${p.format}/${p.goal}`).join(', ')}`);
  },
};
