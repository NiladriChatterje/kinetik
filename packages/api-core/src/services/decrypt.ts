/**
 * RSA private-key decryption for auth credentials.
 *
 * The mobile client encrypts phone + password with the matching public key
 * before sending them. This module decrypts them on the server side.
 */
import crypto from 'crypto';

// RSA-2048 private key (PEM) — same pair as the mobile public key.
// In production, load from an env var or a secrets manager, not hardcoded.
const PRIVATE_KEY = process.env.AUTH_RSA_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQChd5XOvF9/VbWf
szcWvxTyHLpItW8YHpqJ3F/y2FA4SULCrWQX9rTCpedrZQ+GahIJFsM/wPe0Uvbk
JIWqLZchmA36VrMtxr/Q/Fu40NIV5Do9UbwdXQIaDyG55YobQ8TRx2vBanVua2nh
wBMRs+0ENJNw3sGtdSEw5+Ge5lT9bABvZHXAsOgf+8PUFiTHLVus1aJO+GZIgTF6
sVYv9gwEJprCdGm4HgviUhqus0dnvqD1DJ0D1pJL1rr1H2W+QZsz1yiVArPwddbm
8j7jrxBYo1yBZaDhH2l6eZSP1+hFCxBJf1Z+1kzBLx7RSeo5HcVwkFl9mSt3jnGA
IIWUeFTDAgMBAAECggEAQ7gBzmjWrHLn74icTB/ryvcdca0WYMlFCxiv7Qun6VNg
eoF5/0rq2M/31OTXtAn8cm9nh++Ic8pv3ZMrtAnW3rIE+r8t+r7mZ+HPHh4GXkQP
4PPMr4v4e7Fo9aw9Vd4AR/MZUE8z3RGToKiL1trdRuw+AhKKrBL5zqcRyzDS6E2e
zZ7tIYTeelanBXz3antusX+9iGQXp2EBT3dyjmTmgIiuh1rYwDMowJ/kgsHBS3Uc
5DrVHmVSQ0srRke2WVsLWATCZXrJpiJgxWN1JwpuECwPE1zMnuZD7hzoRSHbLa8/
2f09JXUHSsRS0uXWHmKP9tq8JiU3UDzlLPqwLazXUQKBgQDVOfGDoDG5aROF+FHf
xJ1erxB0INpjyYp6XClHLUvW2jU/OZ6PRD5CWLo/cIdPsCnR+adan33kQ306hT/S
igncMPZEEjdOvXSk42o6y9E0FzleWXL4uIlAXEijFypVoIXxtLxDjZAywD3gRjtG
BJm0WpwZDL++9MkBqNGL7Q8EpQKBgQDB25d3uGyOCiTJmhXswdxVBFd9uBPDnSct
ljnNuM+tnZdIbBR/R3Kx3R0W63snQyLN0Ikt9vEo5RyCaqrCfVsJ/w8RFa5mcE7d
QpV1yrb5YjKVHrp1FZP9+QVs6qQR37b4rk8bMCP8wplhpRx0JMms0Yc28320z1Q5
MEtLdpjvRwKBgQC4m7s7j+WdNpldo1oXl938TSu8r3kFbkgDmmluo4wGz9PMErHy
Lk6NGM7gAChW2RnMHw9DCdVwXPI+SYGxYiwZRRbiZrcV6DfmTrL5ht9w7y6PPnip
WPQUEhIdif/wNNPjKezZu+X92q130Lae73q4SL7ffUdCKCMj2arbL/qRtQKBgHFV
24D/zl9gaM+AiS7oy9LcffYfJ1bmyt/pAxRV5vzetHJ/1Z/v+osn9XjP5Sk4I+Hl
+D1qMOWyxO8uQ3T/ark2Z+2aGmMDZ+gNpGnAQScdlOr/kw0et231J4ncyF02yLcs
2UzQ4UlFz/x5VmBEna+us/mZczXBPMFOjcapqJHDAoGAN9KhjIk9m1j73xElerOP
QZSu3VWsbiYFpfgNxdavevpynBKozYfiPIiGV7f33Kdqv8FszOBFAI2aaVW4CV/B
2Eyi/WrudMHH9s2KCGGu5+zoacF4ufFu1oFLXYFHibfRW6tE2NfGDt6eXb9G4brt
7wW8xNUMfISh7bfKeE3H2gY=
-----END PRIVATE KEY-----`;

/**
 * Decrypt a Base64-encoded RSA ciphertext with the server's private key.
 */
export function decryptField(ciphertext: string): string | null {
  try {
    const buffer = Buffer.from(ciphertext, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      buffer,
    );
    return decrypted.toString('utf-8');
  } catch (err: any) {
    console.error('[decrypt] RSA decryption failed:', err.message);
    return null;
  }
}

/**
 * Decrypt fields in a request body that were encrypted by the mobile client.
 * Returns a new object with decrypted values. If the payload is not encrypted
 * (legacy clients), returns the original object unchanged.
 */
export function decryptAuthPayload<T extends Record<string, any>>(
  data: T,
  fields: (keyof T)[],
): T {
  if (!data || !(data as any)._encrypted) {
    return data; // Legacy unencrypted payload — pass through
  }

  const result = { ...data };
  delete (result as any)._encrypted;

  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      const decrypted = decryptField(value);
      if (decrypted !== null) {
        (result as any)[field] = decrypted;
      } else {
        throw new Error(`Decryption failed for field: ${String(field)}`);
      }
    }
  }

  return result;
}
