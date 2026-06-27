refactor: move Wallet from bottom tab into Profile settings

Why: The bottom tab bar was getting crowded with 5 tabs. Wallet
is an infrequently-visited screen (token balance, transaction
history) that doesn't need its own persistent tab. Consolidating
it into Profile simplifies the navigation.

What:
- Removed TokenVault from MainTabParamList and the bottom tab
  navigator (tab bar is now 4 items: Flash, Radar, Match, Profile)
- Added TokenVault to RootStackParamList and registered it as a
  RootStack.Screen so it can be navigated to as a full-screen
  overlay from Profile
- Added "Wallet" (wallet-outline icon) entry to the Profile
  settings list, between Duo Wingman and Privacy
- Existing TokenVaultScreen import and component reused —
  no code changes needed inside the screen itself
