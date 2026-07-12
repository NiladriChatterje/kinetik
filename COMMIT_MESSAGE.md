feat: add unit tests for chat flow, KYC document picker fix, push notification review

## Changes

### Unit Tests for Chat Messaging Flow
- Add vitest configuration for `packages/realtime` and `packages/api-core`
- Add 26 comprehensive unit tests for `ChatHandler` in `packages/realtime`:
  - Socket events: chat:join, chat:leave, chat:message, chat:typing, chat:read
  - Content validation: empty, whitespace-only, 2000-char limit, trimming
  - Redis pub/sub cross-instance delivery: subscription, JSON parsing, channel filtering
  - broadcastMessage() method
- Add 18 unit tests for message API in `packages/api-core`:
  - Input validation rules, push notification preview truncation
  - Match membership verification, partner identification
  - Redis publish channel & payload shape, push notification targeting
- Add `test` and `test:watch` scripts to both package.json files

### KYC Document Picker Fix
- Remove unused `expo-file-system/legacy` import from KYC screen
- Fix document picker to handle empty/null `assets` array (common on Android)
- Add MIME type fallback from file extension when picker returns null/octet-stream
- Support both old API (`result.type === 'cancel'`) and new API (`result.canceled`)
- Add platform-specific error messages for Android file access issues
- Add `expo-document-picker` to app.json plugins array for native module linking

### Documentation
- Add KINETIK_FEATURES_DOC.md — comprehensive list of all app features
- Add PUSH_NOTIFICATION_REVIEW.md — audit of push notification pipeline with 10 identified issues and prioritized fix recommendations

### Infrastructure
- Add `resolve.alias` for `@kinetik/shared` in both vitest configs for monorepo resolution
- Add `console.error` logging to KYC document picker for easier debugging
