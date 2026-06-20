feat: toast redesign + Android OTP auto-read via react-native-otp-verify

Toast redesign (cooler look + top-right positioning):
- Redesigned ToastCard with accent-colored left bar, icon indicator (checkmark/close), and dot separator between title and message
- Softer card background (#1c1c1e) with deeper shadow (elevation 16, shadow radius 20)
- Pinned toasts to top-right corner via contentContainerStyle (alignItems: 'flex-end')
- Removed left border/overflow hidden that clipped iOS shadow

Android OTP auto-read integration:
- Installed react-native-otp-verify package
- Input.tsx: Added textContentType prop for iOS oneTimeCode support
- SplashScreen.tsx: Integrated useOtpVerify hook to auto-detect 6-digit SMS OTP
  - Auto-fills OTP field with detected code and shows success toast
  - Logs app hash on mount for backend SMS template configuration
  - Passes textContentType='oneTimeCode' to OTP Input on iOS for native keyboard suggestion
