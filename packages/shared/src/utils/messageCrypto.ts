/**
 * Message Encryption & Compression Utility
 *
 * Compresses message content with gzip, then encrypts with AES-256-GCM
 * before storage. Reverses on read. Uses a server-side key from env.
 *
 * If MESSAGE_ENCRYPTION_KEY is not set, content passes through unmodified
 * (no encryption/compression) so the app still works in dev without config.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { gzipSync, gunzipSync, constants } from 'zlib';

/** Derive a 32-byte key from any-length passphrase using SHA-256 */
function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase, 'utf8').digest();
}

/**
 * Encrypt and compress message content.
 * Returns a base64-encoded string safe for TEXT column storage.
 */
export function encryptMessage(plaintext: string, encryptionKey: string): string {
  if (!encryptionKey) return plaintext; // pass-through when unconfigured

  // Compress first (gzip, best speed)
  const compressed = gzipSync(plaintext, {
    level: constants.Z_BEST_SPEED,
  });

  // Encrypt with AES-256-GCM
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv (12) + authTag (16) + encrypted (variable) → base64
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt and decompress message content.
 * Returns original plaintext.
 */
export function decryptMessage(ciphertext: string, encryptionKey: string): string {
  if (!encryptionKey) return ciphertext; // pass-through when unconfigured

  try {
    const combined = Buffer.from(ciphertext, 'base64');

    // Parse: iv (12) + authTag (16) + encrypted (rest)
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const encrypted = combined.subarray(28);

    const key = deriveKey(encryptionKey);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    // Decompress
    return gunzipSync(decrypted).toString('utf8');
  } catch {
    // If decryption fails (wrong key, corrupted data, or plaintext stored),
    // return the original string as-is (fallback for unencrypted data)
    return ciphertext;
  }
}
