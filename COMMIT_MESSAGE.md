feat: comprehensive auth, onboarding, and UI overhaul — error differentiation, toast system, DOB auto-format, inline validation, navigation bar immersive mode

### Backend
- **auth.ts**: Login route now returns differentiated error codes:
  - `USER_NOT_FOUND` — phone number not registered
  - `INVALID_PASSWORD` — wrong password for existing account
  - `UNAUTHORIZED` — OTP-only users trying password login

### Shared Constants
- **constants/index.ts**: Added `USER_NOT_FOUND` and `INVALID_PASSWORD` error codes

### Mobile — Toast System
- **Installed** `react-native-toast-message` and `expo-navigation-bar`
- **App.tsx**: Custom toast config with floating top-right dark cards:
  - Slide-in-from-right spring animation on mount
  - Error type: red accent (#FF6B6B)
  - Success type: green accent (#4CAF50)
  - Single-line layout with smaller fonts (12px/11px)
  - Tappable to dismiss, 4-second auto-hide
- **App.tsx**: Android immersive mode using `expo-navigation-bar`:
  - `setVisibilityAsync('hidden')` — hides system nav bar
  - `setBehaviorAsync('overlay-swipe')` — swipe from edge to reveal
- **hooks/useToast.ts**: New reusable hook exposing `showError()`, `showSuccess()`, `showInfo()`
- All screens updated to use the hook instead of direct `Toast` imports

### Mobile — Auth & Onboarding
- **authStore.ts**: Removed automatic `getProfile()` API call on startup — no API requests fire until the user submits credentials
- **SplashScreen.tsx**: Added success toasts for login/register/OTP; replaced inline error text with floating error toasts
- **IdentityScreen.tsx**:
  - Removed redundant "Full Name" field (firstName collected during registration)
  - DOB auto-format: `formatDob()` adds "/" immediately when DD is complete (2 digits) and when MM is complete (2 more digits)
  - DOB field uses `syncOnChange` prop for real-time formatting while focused
  - Inline validation for gender selection with touched-state tracking
  - DOB age >= 18 validation with toast feedback
  - Footer uses safe area insets (`insets.bottom + 40`) to clear the system navigation bar
  - Submit also marks all fields as touched for instant validation feedback

### Mobile — Input Component
- **Input.tsx**: Added `syncOnChange` prop for fields where the parent reformats text (e.g. auto-formatted DOB)
- Fixed `onBlur` handler to sync the controlled (formatted) value instead of raw input when `syncOnChange` is active
- Added `valueRef` to track the controlled value separately from raw user input

### Mobile — Onboarding Screen Toasts
- **LocationPermissionScreen**: Replaced native `Alert.alert` with floating toast for denied permission; added success toast on permission granted
- **PhotoUploadScreen**: Added success toast on continue
- **PoseVerificationScreen**: Added success toast when liveness check completes
- **KYCScreen**: Added welcome toast when setup is complete
