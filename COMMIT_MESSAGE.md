feat: glassmorphic error toast + graceful PHONE_EXISTS handling + identity screen validation

Mobile:
- Added GlassToast component: black glassmorphic toast with translucent
  background, subtle border, shadow, and bottom slide-in animation
- Updated App.tsx to register custom glass toast type with bottom positioning
- Updated useToast hook with showGlass method (3s visibility)
- SplashScreen: PHONE_EXISTS (409) now shows a graceful glass toast
  "Phone already exists! / Try signing in instead." instead of a generic
  error toast at the top
- Refactored authStore.getErrorMessage() → getErrorResponse() to surface
  errorCode (PHONE_EXISTS, EMAIL_EXISTS, etc.) through AuthResult
- IdentityScreen: All three fields (DOB, gender, pronouns) are now validated
  on submit with a glass toast "Must fill all the fields!" if any are
  missing. Removed silent disabled-button pattern — button is always
  pressable and shows clear validation feedback via toast.
