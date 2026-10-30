import type { Brief } from '../schemas/brief.js';
import { TRUTHFULNESS_RULES, bullets, sections, type BuiltPrompt } from './shared.js';

export const ANALYSIS_SITE_PROMPT_VERSION = 'analysis.site@1';

export interface AnalysisSitePromptInput {
  brief: Brief;
  /** Domains web_search is restricted to (brand website + shops). */
  allowedDomains: string[];
  /** ISO date of the research, used as the retrieval date. */
  today: string;
}

/**
 * Stage 02a — research the brand on its official website/shop with web_search.
 * Produces brand facts and, per brief product, the official page, current price and literal claims.
 */
export function buildAnalysisSitePrompt({ brief, allowedDomains, today }: AnalysisSitePromptInput): BuiltPrompt {
  const system = sections(
    `You are a meticulous brand researcher preparing a fact sheet for an Instagram content team.
You use web search restricted to the brand's official domains and report only what those pages actually say.`,
    `## Task
1. Research the brand on its official website and shop: what it sells, positioning, assortment highlights, services (delivery, returns, loyalty) relevant to Croatian customers.
2. For each product listed in the input, find its official product page on the allowed domains and extract:
   - the page URL;
   - the CURRENT price exactly as displayed (amount, currency, the variant/size it applies to, and whether it is a promotional or regular price);
   - claims printed literally on that page (e.g. protein per serving, certifications, flavour range). Copy wording closely; translate to English in "statement" and keep the original-language quote in "evidence".`,
    `## Rules
${bullets([
  ...TRUTHFULNESS_RULES,
  `Use only these domains as sources: ${allowedDomains.join(', ')}. Information from any other site must be tagged "assumption" (or left out).`,
  'Prices: set "confident": true only when you read one unambiguous current price on the official product page. If the price varies by size/flavour, is a promo vs regular price, or you could not open the page, set "confident": false and explain in "uncertaintyNote". Never estimate a price; use null if not found.',
  'Product claims: include only claims literally on the official product page. No health or performance claims from your own knowledge.',
  'If a product page or section cannot be accessed or found, add it to "sourcesUnavailable" with the reason, and keep the product entry with null values.',
  'Return one entry in "products" for every product in the input, using the input name verbatim as "briefProductName".',
  'Write statements in English. Keep each fact atomic (one claim per fact).',
])}`,
    `## Output
Return JSON matching the provided schema. Aim for 6–12 brand facts and the key claims (up to ~6) per product.`,
  );

  const products = brief.products
    .map((p, i) => {
      const url = p.url ?? 'not provided — find the official product page on the allowed domains';
      return `${i + 1}. ${p.name}\n   URL: ${url}${p.notes ? `\n   Notes from brief: ${p.notes}` : ''}`;
    })
    .join('\n');

  const input = sections(
    `Brand: ${brief.brand.name}`,
    `Official website: ${brief.brand.website}${brief.brand.shopUrls.length ? `\nShops: ${brief.brand.shopUrls.join(', ')}` : ''}`,
    `Allowed research domains: ${allowedDomains.join(', ')}`,
    `Market: Croatia (prices expected in EUR). Research date: ${today}.`,
    `Products to research:\n${products}`,
  );

  return { system, input };
}
