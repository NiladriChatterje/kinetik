/**
 * The fixed choices a profile is made of. Picked on the identity onboarding
 * step and changed later on Edit profile, so both screens read one list.
 */

// Male, Female or Prefer not to say, nothing else. Who sees whom is server
// logic (api-core routes/matches.ts): men never see men, women never see
// women, and Prefer not to say is shown to and sees everyone.
export const GENDER_OPTIONS = ['Male', 'Female', 'Prefer not to say'] as const;
export type GenderOption = (typeof GENDER_OPTIONS)[number];

// What the server stores for each label (the gender_identity enum). Lowercasing
// the label gave "prefer not to say", which the server rejects.
export const GENDER_VALUES: Record<GenderOption, string> = {
  Male: 'male',
  Female: 'female',
  'Prefer not to say': 'prefer_not_to_say',
};

/**
 * The option for a stored gender value, or null when the value is not one of
 * the three offered. Gender is picked once at sign-up and locked after, so a
 * profile saved with the retired Non-binary / Other keeps it (genderLabelFor).
 */
export function genderOptionFor(value: unknown): GenderOption | null {
  return GENDER_OPTIONS.find((g) => GENDER_VALUES[g] === value) ?? null;
}

/** Retired choices some older profiles still hold; shown, never offered. */
const LEGACY_GENDER_LABELS: Record<string, string> = {
  non_binary: 'Non-binary',
  other: 'Other',
};

/** What to show for any stored gender value, retired ones included. */
export function genderLabelFor(value: unknown): string {
  const option = genderOptionFor(value);
  if (option) return option;
  if (typeof value === 'string' && LEGACY_GENDER_LABELS[value]) return LEGACY_GENDER_LABELS[value];
  return 'Not set';
}

export const DATING_CATEGORIES = [
  { value: 'casual', label: 'Casual', description: 'Fun dates, new connections' },
  { value: 'serious', label: 'Serious', description: 'Looking for something real' },
  { value: 'intimacy', label: 'Intimacy', description: 'Deep chemistry, no games' },
] as const;
export type DatingCategoryValue = (typeof DATING_CATEGORIES)[number]['value'];

export function isDatingCategoryValue(value: unknown): value is DatingCategoryValue {
  return DATING_CATEGORIES.some((c) => c.value === value);
}
