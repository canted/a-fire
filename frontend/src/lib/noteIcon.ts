/** Existing Notes icon contract: unique emoji symbols, with prose removed. */
export function sanitizeNoteIcon(value: string) {
  return Array.from(new Set(value.match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu) ?? [])).join('');
}
