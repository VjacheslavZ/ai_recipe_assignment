import type { Brief } from '../schemas/brief.js';
import { TRUTHFULNESS_RULES, bullets, sections, type BuiltPrompt } from './shared.js';

export const ANALYSIS_INSTAGRAM_PROMPT_VERSION = 'analysis.instagram@1';

export interface AnalysisInstagramPromptInput {
  brief: Brief;
  /** File names of the screenshots, in the order the images are attached. */
  screenshotFiles: string[];
}

/** Stage 02b — vision analysis of human-provided Instagram screenshots (ADR-005). */
export function buildAnalysisInstagramPrompt({ brief, screenshotFiles }: AnalysisInstagramPromptInput): BuiltPrompt {
  const system = sections(
    `You are a senior social-media art director analysing a brand's Instagram presence from screenshots.
Your analysis will be the style guide for creating new posts that must feel unmistakably on-brand.`,
    `## Task
Study the attached screenshots (feed grid and individual posts/stories) and describe:
- tone of voice and the audience the posts speak to;
- recurring content pillars/themes;
- visual style: dominant brand colours as uppercase HEX codes (estimate from the images; list the 3–6 that define the brand, most important first), typography (weight, case, style; name a font only if you recognise it, otherwise describe it), recurring layout patterns (where text, product and logo sit), photo style (lighting, backgrounds, colour grading, product vs lifestyle shots);
- how products are presented (packshots, cut-outs, in use, close-ups, price badges);
- how people are presented (athletes, anonymous, faces visible, recurring influencers);
- caption style visible in the screenshots: length, emoji use, hashtags, calls to action, language.`,
    `## Rules
${bullets([
  ...TRUTHFULNESS_RULES,
  'Every conclusion must be backed by at least one entry in "observations" whose "source" is the screenshot file name (e.g. "03.png") and whose "evidence" describes what is visible there.',
  'Observations seen directly in a screenshot are "verified"; generalisations across the account beyond what the screenshots show are "assumption".',
  'If a screenshot is unreadable or irrelevant, list it in "screenshotsUnreadable" with the reason.',
  'Do not identify or name real people shown in the images.',
  'Write the analysis in English; quote Croatian caption text verbatim where useful.',
])}`,
    `## Output
Return JSON matching the provided schema. Be specific and concrete — "bold white uppercase sans-serif headline top-left over dark photo" beats "modern typography".`,
  );

  const input = sections(
    `Brand: ${brief.brand.name} (${brief.brand.instagramHandle}, ${brief.brand.instagramUrl})`,
    `Market: Croatia; captions are expected in Croatian.`,
    `Attached screenshots, in order: ${screenshotFiles.join(', ')}`,
  );

  return { system, input };
}
