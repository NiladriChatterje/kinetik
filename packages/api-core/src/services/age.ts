/**
 * Kinetik is for adults. These checks back the 18+ rule on the server, so a
 * hand-made API call cannot set a minor's date of birth or finish onboarding
 * without one (the app checks too, but the app alone is not enough).
 */

export const MINIMUM_AGE = 18;

/** The latest timezone on Earth (UTC+14). Judging "today" there means an
 *  18th birthday anywhere in the world counts as soon as it has begun, so a
 *  member in India is never refused on the morning of their birthday. */
const LATEST_TZ_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * True when `iso` (YYYY-MM-DD) is a real calendar date, not before 1900, on
 * which the person has turned 18 by today in the latest timezone. Someone born
 * on 29 February turns 18 on 1 March in a non-leap year.
 */
export function isAdultBirthDate(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900) return false;

  // Rejects dates that roll over, such as 2001-02-30
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) {
    return false;
  }

  const eighteenth = Date.UTC(year + MINIMUM_AGE, month - 1, day);
  const latest = new Date(now.getTime() + LATEST_TZ_OFFSET_MS);
  const todayLatest = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate());
  return eighteenth <= todayLatest;
}

/**
 * A date_of_birth value as read from Postgres (node-pg returns DATE columns
 * as a Date at local midnight) or as a string, in YYYY-MM-DD form.
 */
export function birthDateToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return m ? m[1] : null;
  }
  return null;
}

export const UNDERAGE_MESSAGE = 'Enter a valid date of birth. Kinetik is only for adults aged 18 and over.';
