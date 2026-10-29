/**
 * The "about yourself" description: plain ASCII text (letters, digits,
 * punctuation, spaces and line breaks; no emoji or other symbols) of at most
 * 120 words. The app applies the same rule (utils/bio.ts); this backs it so a
 * hand-made request cannot store anything else.
 */

export const BIO_MAX_WORDS = 120;
export const BIO_MAX_CHARS = 800;

const NON_ASCII = /[^\x20-\x7E\n]/;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Why a bio is refused, or null when it is acceptable (an empty bio is). */
export function bioProblem(text: string): string | null {
  if (NON_ASCII.test(text)) {
    return 'Your description can use plain letters, numbers and punctuation only. Emojis and special characters are not allowed.';
  }
  if (text.length > BIO_MAX_CHARS) {
    return `Your description is too long. Keep it to ${BIO_MAX_WORDS} words.`;
  }
  const words = countWords(text);
  if (words > BIO_MAX_WORDS) {
    return `Keep your description to ${BIO_MAX_WORDS} words. It has ${words}.`;
  }
  return null;
}
