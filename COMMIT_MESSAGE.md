fix: skip onboarding for returning users with completed profiles

- authStore.verifyOtp now checks onboardingComplete from backend response
  and sets onboardingStep to 'complete' so completed users skip onboarding
- authStore.initialize fetches user profile on app restart to determine
  onboarding status instead of always defaulting to 'splash'
- ProfileLedgerScreen fetches real profile data (displayName, photos,
  bio, location) from backend on mount instead of using mock data
