fix: skip Identity screen when profile data already exists in database

Issue: Users who filled in profile details (dob, gender, pronouns) but
didn't complete the full onboarding flow (onboarding_complete flag is
false) were forced to re-fill the Identity screen on every login.

Fix:
- authStore.verifyOtp now fetches the user's profile after OTP verification
  and checks if identity data actually exists in the database. If dob,
  gender, and pronouns are present, the onboardingStep is computed
  accurately (e.g. 'identity') instead of defaulting to 'splash'.
- OTPVerifyScreen navigation is now step-aware: 'identity' skips to
  Location, 'location'/'photos'/'pose'/'kyc' map to their respective
  next screens, 'complete' goes to Main, and 'splash' starts fresh.
