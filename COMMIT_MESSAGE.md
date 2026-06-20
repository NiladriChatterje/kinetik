feat: dismiss keyboard on tap outside input fields

- Changed keyboardShouldPersistTaps from "always" to "handled" on
  SplashScreen and IdentityScreen ScrollViews
- Tapping empty space outside inputs now dismisses the keyboard
- Taps on interactive elements (buttons, chips, inputs) still work
  normally when keyboard is open
