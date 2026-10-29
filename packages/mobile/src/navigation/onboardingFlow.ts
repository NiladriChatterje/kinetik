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
  'Details',
  'Location',
  'Photos',
  'FaceVerification',
  // KYC ("Verify Your Identity") is commented out for now: its ID upload is
  // never reviewed, and the document face match and Aadhaar offline check
  // are switched off on the server. The selfie step finishes onboarding.
  // KYC stays reachable from Profile (KYCVerify).
  // 'KYC',
] as const;

export type OnboardingScreen = (typeof ONBOARDING_SCREENS)[number];

/** users.onboarding_step is the last finished step; this maps it to the next screen. */
const RESUME_SCREEN: Record<string, OnboardingScreen> = {
  identity: 'About',
  about: 'Details',
  details: 'Location',
  location: 'Photos',
  photos: 'FaceVerification',
  // Users who finished the selfie but not KYC were never marked complete;
  // with KYC commented out they redo the selfie, whose Continue finishes.
  face: 'FaceVerification', // was 'KYC'
  // Legacy value: rows written before migration 019 renamed the step.
  pose: 'FaceVerification', // was 'KYC'
  kyc: 'FaceVerification', // was 'KYC'
};

/** Replace the onboarding stack with every step up to where `step` resumes. */
export function enterOnboarding(navigation: any, step: string | null | undefined): void {
  const target = (step && RESUME_SCREEN[step]) || 'Identity';
  const routes = ONBOARDING_SCREENS.slice(0, ONBOARDING_SCREENS.indexOf(target) + 1).map(
    (name) => ({ name }),
  );
  navigation.reset({ index: routes.length - 1, routes });
}
