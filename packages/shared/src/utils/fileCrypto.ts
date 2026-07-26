/**
 * File Encryption Utility (Buffer-level AES-256-GCM)
 *
 * Encrypts/decrypts arbitrary binary data (audio, images, docs) before
 * storage in MinIO. Uses the same server-side MESSAGE_ENCRYPTION_KEY as
 * text messages, so the encryption is consistent across the platform.
 *
 * Format of encrypted output:
 *   iv (12 bytes) + authTag (16 bytes) + ciphertext (variable)
 *
 * If encryptionKey is empty, data passes through unmodified (dev mode).
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';

/** Derive a 32-byte key from any-length passphrase using SHA-256 */
function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase, 'utf8').digest();
}

/**
 * Encrypt a Buffer with AES-256-GCM.
 * Returns a Buffer in the format: iv (12) + authTag (16) + ciphertext.
 */
export function encryptBuffer(plainBuffer: Buffer, encryptionKey: string): Buffer {
  if (!encryptionKey) return plainBuffer; // pass-through when unconfigured

  const key = deriveKey(encryptionKey);
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv (12) + authTag (16) + encrypted (variable)
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a Buffer that was encrypted with encryptBuffer.
 * Expects the format: iv (12) + authTag (16) + ciphertext.
 * Returns the original plaintext Buffer.
 */
export function decryptBuffer(encryptedBuffer: Buffer, encryptionKey: string): Buffer {
  if (!encryptionKey) return encryptedBuffer; // pass-through when unconfigured

  try {
    // Parse: iv (12) + authTag (16) + encrypted (rest)
    const iv = encryptedBuffer.subarray(0, 12);
    const authTag = encryptedBuffer.subarray(12, 28);
    const encrypted = encryptedBuffer.subarray(28);

    const key = deriveKey(encryptionKey);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    // If decryption fails (wrong key, corrupted data, or unencrypted data),
    // return the original buffer as-is (fallback for unencrypted data)
    return encryptedBuffer;
  }
}
