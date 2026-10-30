/** A prompt ready for `AiClient.structured`: system instructions + user input. */
export interface BuiltPrompt {
  system: string;
  input: string;
}

/** Joins prompt sections, dropping empty ones, with a blank line between them. */
export function sections(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).map((p) => p.trim()).join('\n\n');
}

export function bullets(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

/** Rules shared by every analysis/planning prompt (R12–R14, R24, ADR-017, ADR-018). */
export const TRUTHFULNESS_RULES = [
  'Never invent facts, product properties, ingredients, certifications, awards, prices, discounts or quotes.',
  'Tag every fact: "verified" only if you read it yourself on a source you cite; "assumption" if inferred or not confirmed; "unavailable" if the source could not be accessed.',
  'Cite the exact source for every fact: a full URL (or a screenshot file name for Instagram observations), plus a short literal quote or concrete observation as evidence.',
  'When unsure, say so: use "assumption" or null rather than guessing.',
] as const;
