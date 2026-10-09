/**
 * Onboarding step order and the sign-in hand-off into it.
 *
 * After sign-in the onboarding stack is rebuilt as every step up to the one
 * the user resumes on. Back — the top-left arrow or the Android back button —
 * then walks through the earlier steps and never lands on the spent OTP or
 * sign-in screen.
 */

export const ONBOARDING_SCREENS = [
  'Identity',
  'About',
  'Location',
  'Photos',
  'FaceVerification',
  'KYC',
] as const;

export type OnboardingScreen = (typeof ONBOARDING_SCREENS)[number];

/** users.onboarding_step is the last finished step; this maps it to the next screen. */
const RESUME_SCREEN: Record<string, OnboardingScreen> = {
  identity: 'About',
  about: 'Location',
  location: 'Photos',
  photos: 'FaceVerification',
  face: 'KYC',
  // Legacy value: rows written before migration 019 renamed the step.
  pose: 'KYC',
  kyc: 'KYC',
};

/** Replace the onboarding stack with every step up to where `step` resumes. */
export function enterOnboarding(navigation: any, step: string | null | undefined): void {
  const target = (step && RESUME_SCREEN[step]) || 'Identity';
  const routes = ONBOARDING_SCREENS.slice(0, ONBOARDING_SCREENS.indexOf(target) + 1).map(
    (name) => ({ name }),
  );
  navigation.reset({ index: routes.length - 1, routes });
}
