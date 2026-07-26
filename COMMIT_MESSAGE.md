feat: voice recording with encrypted-at-rest media storage

- Add fileCrypto.ts (AES-256-GCM buffer encryption/decryption)
- Add saveEncryptedChatFile / getEncryptedChatFileBuffer to photoStorage
- Update media upload route to encrypt non-image files at rest
- Add proxy endpoint to decrypt and stream media on-the-fly
- Fix Unsupported FormDataPart implementation by using FileSystem.uploadAsync
- Add Platform.OS check for iOS vs Android audio file handling
- Add expo-av dependency for audio playback
