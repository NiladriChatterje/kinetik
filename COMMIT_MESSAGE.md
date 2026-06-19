## Summary
Replace all emojis with `@expo/vector-icons` and add tab bar icons across the mobile app. Fix TypeScript type errors. Improve docker-compose service orchestration with health checks and Kafka init.

## Changes

### Infrastructure (docker-compose.yml, package.json)
- Add Kafka internal listener `PLAINTEXT_INTERNAL://kafka:29092` for inter-container communication
- Add `kafka-init` service that runs `kafkaAdmin.ts` before dependent services start
- Add health checks for `milvus-etcd` and `milvus-minio`; make Milvus wait for both
- Switch LiveKit to volume-mounted config (`./config/livekit.yaml`); add TURN ports `3478/udp` and `3479/tcp`; add `redis` health dependency
- Update all service `KAFKA_BROKERS` to use internal port `kafka:29092`
- List workspaces explicitly in root `package.json`

### Mobile: Emoji-to-Icon Migration (20+ screen files)
- Replace all emoji characters with `Ionicons` / `MaterialCommunityIcons` from `@expo/vector-icons`
- Use theme colors (`colors.primary`, `colors.textSecondary`, `colors.success`, `colors.textMuted`) for monotonic icon tinting
- Files updated:
  - `SplashScreen.tsx` — logo flash, social auth (Apple/Google)
  - `KYCScreen.tsx` — document type icons, upload, security lock
  - `LocationPermissionScreen.tsx` — GPS location, sync refresh
  - `PhotoUploadScreen.tsx` — camera, add, gallery icons
  - `PoseVerificationScreen.tsx` — camera placeholder, verified checkmark
  - `CommCadenceScreen.tsx` — checkmark circle for completion
  - `PriorityWeightingScreen.tsx` — heart, calendar, location, bulb icons
  - `ValueMatrixScreen.tsx` — rocket, people, compass, home, bulb, heart icons
  - `FlashCountdownScreen.tsx` — location and enter icons
  - `ActiveRadarScreen.tsx` — flash icon on Enter Queue button
  - `VibeCheckScreen.tsx` — person, happy, mic, mute, call, lock icons
  - `CommitmentGateScreen.tsx` — close (pass) and lock-closed (lock) icons
  - `LockStatusScreen.tsx` — sparkles, happy, calendar icons
  - `UnmaskingScreen.tsx` — happy outline for profile placeholder
  - `ReservationLockerScreen.tsx` — lock and checkmark icons
  - `VenueSelectorScreen.tsx` — cafe, wine, restaurant, pizza icons
  - `DoubleDateScreen.tsx` — person icons for camera slots; live dot indicator
  - `DuoWingmanScreen.tsx` — people, sparkles, person, share, enter icons
  - `HeatMapScreen.tsx` — map outline icon
  - `ProfileLedgerScreen.tsx` — mic, heart, lock, calendar, notifications, card, call icons
  - `TokenVaultScreen.tsx` — flash, umbrella, heart icons; arrow-forward on upgrade

### Mobile: Shared Components
- `Input.tsx` — replace eye emoji toggle with `eye-outline`/`eye-off-outline` Ionicons; remove unused `eyeIcon` style
- `RootNavigator.tsx` — add Ionicons tab bar icons: `flash-outline`, `radio-outline`, `people-outline`, `wallet-outline`, `person-outline` with active/inactive tint colors

### Mobile: TypeScript Fixes
- Fix missing `useEffect` import in `ActiveRadarScreen.tsx`
- Replace `&&` style conditionals with ternary `? : undefined` to avoid `false` in style arrays
- Fix duplicate JSX attribute in `VenueSelectorScreen.tsx`
- Fix `route` prop type in `VenueSelectorScreen.tsx`

### Mobile: Config & Deps Maintenance
- Remove `react-native-svg-transformer` from `metro.config.js` and `babel.config.js`
- Remove `module-resolver` plugin from `babel.config.js`
- Update `app.json` with web config
- Run `npm install` — dependencies up to date with Expo SDK 51 (1198 packages)
- TypeScript compilation passes with zero errors
