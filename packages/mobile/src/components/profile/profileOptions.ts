/**
 * The fixed choices a profile is made of. Picked on the identity onboarding
 * step and changed later on Edit profile, so both screens read one list.
 */

export const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'] as const;
export type GenderOption = (typeof GENDER_OPTIONS)[number];

// What the server stores for each label (the gender_identity enum). Lowercasing
// the label gave "non-binary" and "prefer not to say", which the server rejects.
export const GENDER_VALUES: Record<GenderOption, string> = {
  Male: 'male',
  Female: 'female',
  'Non-binary': 'non_binary',
  Other: 'other',
  'Prefer not to say': 'prefer_not_to_say',
};

/** The label for a stored gender value, or null when the value is not one of ours. */
export function genderOptionFor(value: unknown): GenderOption | null {
  return GENDER_OPTIONS.find((g) => GENDER_VALUES[g] === value) ?? null;
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
