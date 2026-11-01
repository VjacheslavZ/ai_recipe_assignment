import { bullets, sections, type BuiltPrompt } from './shared.js';

export const BRIEF_INTAKE_PROMPT_VERSION = 'intake@1';

export interface BriefIntakePromptInput {
  /** The user's request in their own words. */
  text: string;
  /** Product photo file names available for this brand (brand kit + uploads), to fill `imageFile`. */
  productFiles: string[];
}

/** Before stage 01 — turn a free-text request into the fields of a brief, without inventing facts. */
export function buildBriefIntakePrompt({ text, productFiles }: BriefIntakePromptInput): BuiltPrompt {
  const system = sections(
    `You turn a marketer's free-text request into a structured brief for an AI pipeline that creates three Instagram posts for a brand.`,
    `## Rules
${bullets([
  'Identity and sources are never invented: brand name, Instagram handle, website, shop URLs, product names and product page URLs come only from the text. If the text does not give one, return null (or an empty list). Do not guess a website from the brand name.',
  'Instagram: accept "@handle", "handle" or an instagram.com URL; return the handle with a leading "@".',
  'URLs: return them as written, adding "https://" when the scheme is missing. "shopUrls" are extra official shops on OTHER domains than the website; usually empty.',
  'Products: list each product the user wants to promote. "imageFile" must be exactly one of the available product photo file names when one clearly matches the product, otherwise null.',
  'Descriptive fields may be proposed when the text does not state them: "audience", "goals" (1–3, one per post is ideal: education, engagement, saves, product introduction, purchase intent) and "whyThisBrand". Base proposals on what the text says about the brand. List every proposed field in "assumptions" with the value you chose.',
  '"constraints": only extra rules the user states (e.g. "no discounts"). "notes": anything else the planner should know about the posts (not about this brief or missing files). Keep the user\'s meaning; write everything in English.',
])}`,
    `## Output
Return JSON matching the provided schema.`,
  );
  const input = sections(
    `## Request\n${text.trim()}`,
    `## Available product photo files\n${productFiles.length ? bullets(productFiles) : '(none)'}`,
  );
  return { system, input };
}
