/**
 * RSA public-key encryption for auth credentials.
 *
 * Encrypts sensitive fields (phone, password) with the server's public key
 * before sending them over the wire. The server decrypts with its private key.
 * This adds a layer of protection on top of TLS — even if TLS is terminated
 * at a proxy, the payload remains encrypted.
 */
import JSEncrypt from 'jsencrypt';

// Server's RSA-2048 public key (PEM)
// The matching private key stays on the server — never shipped to the client.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoXeVzrxff1W1n7M3Fr8U
8hy6SLVvGB6aidxf8thQOElCwq1kF/a0wqXna2UPhmoSCRbDP8D3tFL25CSFqi2X
IZgN+lazLca/0PxbuNDSFeQ6PVG8HV0CGg8hueWKG0PE0cdrwWp1bmtp4cATEbPt
BDSTcN7BrXUhMOfhnuZU/WwAb2R1wLDoH/vD1BYkxy1brNWiTvhmSIExerFWL/YM
BCaawnRpuB4L4lIarrNHZ76g9QydA9aSS9a69R9lvkGbM9colQKz8HXW5vI+468Q
WKNcgWWg4R9penmUj9foRQsQSX9WftZMwS8e0UnqOR3FcJBZfZkrd45xgCCFlHhU
wwIDAQAB
-----END PUBLIC KEY-----`;

let encryptor: JSEncrypt | null = null;

function getEncryptor(): JSEncrypt {
  if (!encryptor) {
    encryptor = new JSEncrypt();
    encryptor.setPublicKey(PUBLIC_KEY);
  }
  return encryptor;
}

/**
 * Encrypt a plaintext string with RSA-OAEP (PKCS#1 v1.5 padding via jsencrypt).
 * Returns a Base64-encoded ciphertext string.
 */
export function encryptField(plaintext: string): string | null {
  const enc = getEncryptor();
  const encrypted = enc.encrypt(plaintext);
  // jsencrypt returns false on failure
  return encrypted || null;
}

/**
 * Encrypt an object's sensitive fields in-place and return a new object.
 * Used to encrypt login/register payloads before transmission.
 */
export function encryptAuthPayload<T extends Record<string, any>>(
  data: T,
  fields: (keyof T)[],
): T & { _encrypted: true } {
  const result = { ...data, _encrypted: true as const };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      const encrypted = encryptField(value);
      if (!encrypted) {
        throw new Error(`Encryption failed for field: ${String(field)}`);
      }
      (result as any)[field] = encrypted;
    }
  }
  return result;
}
