/**
 * Date of birth as the forms hold it (DD/MM/YYYY) and as the server stores
 * it (YYYY-MM-DD). Shared by the identity onboarding step and Edit profile,
 * so both apply the same formatting and the same 18-to-75 rule (the server
 * enforces the same range in services/age.ts).
 */

export const MIN_AGE = 18;
export const MAX_AGE = 75;

/** Auto-format DOB input as DD/MM/YYYY
 *  Adds "/" the moment DD is complete (2 digits) and when MM is complete (2 more digits). */
export function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);

  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);

  let formatted = dd;
  if (dd.length === 2) formatted += '/';
  formatted += mm;
  if (dd.length === 2 && mm.length === 2) formatted += '/';
  formatted += yyyy;

  return formatted;
}

/** Parse DD/MM/YYYY string and check the age is 18 to 75. */
export function validateDob(dob: string): { valid: boolean; error?: string } {
  const parts = dob.split('/');
  if (parts.length !== 3) {
    return { valid: false, error: 'Please enter a complete date of birth (DD/MM/YYYY).' };
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year) || year < 1900 || year > new Date().getFullYear()) {
    return { valid: false, error: 'Please enter a valid date of birth.' };
  }

  if (month < 1 || month > 12) {
    return { valid: false, error: 'Month must be between 01 and 12.' };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { valid: false, error: `Invalid day for month ${String(month).padStart(2, '0')}.` };
  }

  const birthDate = new Date(year, month - 1, day);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < MIN_AGE) {
    return { valid: false, error: `You must be at least ${MIN_AGE} years old to use Kinetik.` };
  }
  if (age > MAX_AGE) {
    return { valid: false, error: `Kinetik is for people aged ${MIN_AGE} to ${MAX_AGE}. Check the year you entered.` };
  }

  return { valid: true };
}

/** DD/MM/YYYY (already validated) to the YYYY-MM-DD the profile endpoint takes. */
export function dobToIso(dob: string): string {
  const parts = dob.split('/');
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * The profile endpoint's date of birth (YYYY-MM-DD, or the full ISO timestamp
 * a DATE column serialises to) as DD/MM/YYYY for the form; '' when unset.
 */
export function isoToDob(value: unknown): string {
  const iso = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : '';
}
