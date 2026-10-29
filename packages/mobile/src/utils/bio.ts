/**
 * The "about yourself" description: plain ASCII text (letters, digits,
 * punctuation, spaces and line breaks; no emoji or other symbols) of at most
 * 120 words. Shared by the onboarding details step and Edit profile; the
 * server applies the same rule in services/bio.ts.
 */

export const BIO_MAX_WORDS = 120;
/** Hard character cap for the input; 120 words fit comfortably below it. */
export const BIO_MAX_CHARS = 800;

/** Drops every character outside printable ASCII (keeps line breaks), so an emoji never lands in the box. */
export function sanitizeBio(text: string): string {
  return text.replace(/[^\x20-\x7E\n]/g, '').slice(0, BIO_MAX_CHARS);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Empty is fine (the field is optional); otherwise ASCII only and within the word limit. */
export function validateBio(text: string): { valid: boolean; error?: string } {
  if (/[^\x20-\x7E\n]/.test(text)) {
    return { valid: false, error: 'Use plain letters, numbers and punctuation only. Emojis and special characters are not allowed.' };
  }
  const words = countWords(text);
  if (words > BIO_MAX_WORDS) {
    return { valid: false, error: `Keep it to ${BIO_MAX_WORDS} words. You have ${words}.` };
  }
  return { valid: true };
}
