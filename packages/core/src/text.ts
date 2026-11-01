/** Slide text is rendered with fonts that have no emoji: they would show as boxed codes. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
