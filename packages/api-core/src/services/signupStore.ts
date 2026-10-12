import Redis from 'ioredis';

/**
 * Sign-ups waiting for their emailed code. Nothing touches Postgres until the
 * code is verified: the form, the password hash and the code live here, in
 * the `otp-store` Redis container (docker-compose.yml), and expire on their
 * own. Abandoned or failed sign-ups never cost a database query.
 *
 * Keys, per lowercased email:
 *   signup:pending:<email>  hash { code, data, attempts, sentAt }, 5 min TTL
 *   signup:sends:<email>    codes emailed in the current 24 h window
 */

export const SIGNUP_CODE_TTL_SECONDS = 5 * 60;
export const SIGNUP_MAX_ATTEMPTS = 3;
export const SIGNUP_MAX_SENDS_PER_DAY = 3;
export const SIGNUP_RESEND_COOLDOWN_SECONDS = 30;
const SEND_WINDOW_SECONDS = 24 * 60 * 60;

const pendingKey = (email: string) => `signup:pending:${email}`;
const sendsKey = (email: string) => `signup:sends:${email}`;

let client: Redis | null = null;

function store(): Redis {
  if (!client) {
    client = new Redis(process.env.OTP_STORE_URL || 'redis://localhost:6379', {
      // A sign-up should fail fast with "try again" rather than hang while
      // the container restarts.
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    client.on('error', (err) => console.error('[signupStore] Redis error:', err.message));
  }
  return client;
}

export interface PendingSignup {
  codeHash: string;
  /** The validated form, with the password already hashed. */
  data: string;
  attempts: number;
  sentAt: number;
}

// INCR and EXPIRE in one step: a crash between them would leave a counter
// with no TTL, locking the address for good. Over the limit nothing is counted.
const CLAIM_SEND = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if n > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return {-1, redis.call('TTL', KEYS[1])}
end
return {n, 0}`;

// Only an existing counter is decremented; DECR on an expired key would
// create one with no TTL.
const REFUND_SEND = `
if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then redis.call('DECR', KEYS[1]) end
return 0`;

/**
 * Counts one emailed code against the daily allowance. Returns how many are
 * left after this one, or `locked` with the seconds until the window resets
 * when the allowance was already spent (nothing is counted then).
 */
export async function claimSend(
  email: string,
): Promise<{ locked: false; sendsLeft: number } | { locked: true; retryAfterSeconds: number }> {
  const [count, ttl] = (await store().eval(
    CLAIM_SEND, 1, sendsKey(email), SEND_WINDOW_SECONDS, SIGNUP_MAX_SENDS_PER_DAY,
  )) as [number, number];
  if (count < 0) return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : SEND_WINDOW_SECONDS };
  return { locked: false, sendsLeft: SIGNUP_MAX_SENDS_PER_DAY - count };
}

/** Gives a send back when Brevo did not deliver it. */
export async function refundSend(email: string): Promise<void> {
  await store().eval(REFUND_SEND, 1, sendsKey(email));
}

/** Seconds until another code may be sent, 0 when sends are still left. */
export async function lockSeconds(email: string): Promise<number> {
  const key = sendsKey(email);
  const [count, ttl] = await Promise.all([store().get(key), store().ttl(key)]);
  if (Number(count ?? 0) < SIGNUP_MAX_SENDS_PER_DAY) return 0;
  return ttl > 0 ? ttl : SEND_WINDOW_SECONDS;
}

/** Stores a fresh code, replacing any earlier one and its attempts. */
export async function savePending(email: string, codeHash: string, data: string): Promise<void> {
  await store()
    .multi()
    .del(pendingKey(email))
    .hset(pendingKey(email), { code: codeHash, data, attempts: 0, sentAt: Date.now() })
    .expire(pendingKey(email), SIGNUP_CODE_TTL_SECONDS)
    .exec();
}

export async function getPending(email: string): Promise<PendingSignup | null> {
  const row = await store().hgetall(pendingKey(email));
  if (!row.code) return null;
  return {
    codeHash: row.code,
    data: row.data,
    attempts: Number(row.attempts),
    sentAt: Number(row.sentAt),
  };
}

// HINCRBY alone would recreate a key that expired a moment ago, without a TTL.
const RECORD_ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
return redis.call('HINCRBY', KEYS[1], 'attempts', 1)`;

/**
 * Counts a guess atomically, so parallel requests cannot exceed the limit.
 * Returns the attempts so far including this one, or -1 when the code expired.
 */
export async function recordAttempt(email: string): Promise<number> {
  return Number(await store().eval(RECORD_ATTEMPT, 1, pendingKey(email)));
}

/**
 * Removes the pending sign-up. Resolves true only for the caller that
 * actually removed it, so a correct code is consumed exactly once.
 */
export async function deletePending(email: string): Promise<boolean> {
  return (await store().del(pendingKey(email))) === 1;
}
