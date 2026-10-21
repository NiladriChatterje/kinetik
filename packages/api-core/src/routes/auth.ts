import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { ERROR_CODES, transaction, TABLES, geoToH3 } from '@kinetik/shared';
import { createUser, findUserByPhone, findUserByEmail, findUserById, createSubscription, getSubscription, query } from '../services/database';
import {
  claimSend, refundSend, lockSeconds, savePending, getPending, recordAttempt, deletePending,
  SIGNUP_CODE_TTL_SECONDS, SIGNUP_MAX_ATTEMPTS, SIGNUP_MAX_SENDS_PER_DAY, SIGNUP_RESEND_COOLDOWN_SECONDS,
} from '../services/signupStore';
import { deleteAllUserPhotos, deleteAllUserKycDocuments, deleteChatFile } from '../services/photoStorage';
import { isPlayBillingConfigured, cancelSubscription } from '../services/playBilling';
import { invalidateFreeChatCache } from '../services/premiumAccess';
import { eventBus } from '../services/eventBus';
import { sendOtpEmail, isEmailConfigured, maskEmail } from '../services/email';
import { resolveCity } from '../services/locations';

/**
 * Extract a MinIO storage key from a chat media URL so the file can be
 * deleted from object storage. Handles both plain uploads
 * (/uploads/chat/{userId}/{fileId}.ext) and the encrypted proxy URLs
 * (/api/v1/matches/media/chat/{userId}/{fileId}.enc?ext=...).
 */
function chatMediaKeyFromUrl(url: string): string | null {
  if (url.startsWith('/api/v1/matches/media/')) {
    const path = url.split('/api/v1/matches/media/')[1];
    return path ? path.split('?')[0] : null;
  }
  if (url.startsWith('/uploads/')) {
    const key = url.replace('/uploads/', '');
    return key || null;
  }
  return null;
}

// ─── Sign-up codes ───────────────────────────────────
// Sign-up is proven with a code emailed through Brevo. Until it is verified
// the attempt lives only in the otp-store Redis (services/signupStore.ts):
// no database query runs for a sign-up that is never confirmed.

/** Lowercase + trim so "Alice@Example.com " and "alice@example.com" are one account. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Random 6-digit code when Brevo is configured to email it. Otherwise the
 * code is only logged, so it stays the fixed 123456 documented in
 * FREE_HOSTING_GUIDE.md for testing.
 */
function generateCode(): string {
  if (!isEmailConfigured()) return '123456';
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Codes are kept hashed, salted with the address, never in plain text. */
function hashCode(email: string, code: string): string {
  return crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
}

function codeMatches(email: string, code: string, storedHash: string): boolean {
  const given = Buffer.from(hashCode(email, code), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The validated sign-up form as kept in the otp-store until it is verified. */
interface PendingSignupData {
  passwordHash: string;
  displayName?: string;
  countryCode: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

const OTP_SEND_FAILED = {
  success: false,
  error: {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Could not send the verification code right now. Please try again in a minute.',
  },
};

const SIGNUP_UNAVAILABLE = {
  success: false,
  error: {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Sign-up is unavailable right now. Please try again in a minute.',
  },
};

function signupLocked(retryAfterSeconds: number) {
  return {
    success: false,
    error: {
      code: ERROR_CODES.SIGNUP_LOCKED,
      message: `You have used all ${SIGNUP_MAX_SENDS_PER_DAY} verification codes for today. Try again in 24 hours.`,
      retryAfterSeconds,
    },
  };
}

// ─── Refresh Token Helpers ───────────────────────────────────
// A signed-in user stays signed in until they sign out, uninstall, or the
// account/database is removed. Each refresh rotates to a fresh token with a
// fresh expiry, so this is only a ceiling on a device that never comes back.
const REFRESH_TOKEN_TTL_DAYS = 3650;

// A token that was just rotated may be presented again when the response
// carrying its successor was lost (network drop, app killed mid-refresh, the
// app gave up waiting while the database was waking) or when two refreshes
// race. Inside this window that is treated as a retry and a new pair is
// issued.
const REFRESH_REUSE_GRACE_MS = 2 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function storeRefreshToken(userId: string, tokenHash: string, familyId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, familyId, expiresAt],
  );
}

/**
 * Ends tokens for good. Rotation only sets revoked_at, which the grace rules
 * above may still honour; a killed token is also expired on the spot, which
 * nothing honours. Used for replay, retired successors and sign-out.
 */
async function killTokens(where: string, params: unknown[]): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW()
     WHERE ${where} AND revoked_at IS NULL`,
    params,
  );
}

/**
 * Looks a refresh token up and decides whether it may be used.
 *
 * A revoked token is still honoured when the device evidently never received
 * its successor: either it was rotated moments ago (two refreshes racing, or
 * the first answer lost), or no later token in the family has ever been used.
 * In the second case the unused successors are revoked so a token lost in
 * transit cannot be picked up by anyone else. Only when a later token in the
 * family HAS been used, proof that the device did get its successor, is the
 * old token treated as a replay and the whole family revoked.
 *
 * The rule exists so that a slow server can never sign a user out: the only
 * refusals left are a token that was never issued, has passed its ten-year
 * ceiling, or belongs to a revoked family.
 */
async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; familyId: string; graceReuse: boolean } | null> {
  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT user_id, family_id, revoked_at, expires_at, created_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;

  // Token expired (killTokens sets expires_at to the current instant)
  if (new Date(row.expires_at) <= new Date()) return null;

  if (!row.revoked_at) {
    return { userId: row.user_id, familyId: row.family_id, graceReuse: false };
  }

  // Rotated moments ago: the client most likely never received the
  // successor. Let it through once more as a retry.
  const revokedAgo = Date.now() - new Date(row.revoked_at).getTime();
  if (revokedAgo >= 0 && revokedAgo < REFRESH_REUSE_GRACE_MS) {
    return { userId: row.user_id, familyId: row.family_id, graceReuse: true };
  }

  // Revoked longer ago. Was the successor ever used? A later token in the
  // family that was rotated (revoked but not killed, see killTokens) proves
  // the device held it, since only its holder could rotate it.
  const usedLater = await query(
    `SELECT 1 FROM refresh_tokens
     WHERE family_id = $1 AND created_at > $2 AND revoked_at IS NOT NULL AND expires_at > NOW()
     LIMIT 1`,
    [row.family_id, row.created_at],
  );
  if (usedLater.rows.length > 0) {
    // The device had the successor and is presenting the old token anyway:
    // replay. Kill the entire family.
    await killTokens(`family_id = $1`, [row.family_id]);
    return null;
  }

  // The successor was issued but never used: the answer carrying it was
  // lost. Retire it and let this token stand in for one more rotation.
  await killTokens(`family_id = $1 AND created_at > $2`, [row.family_id, row.created_at]);
  return { userId: row.user_id, familyId: row.family_id, graceReuse: true };
}

async function rotateRefreshToken(oldToken: string, newTokenHash: string): Promise<boolean> {
  const oldHash = hashToken(oldToken);
  const result = await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING user_id, family_id`,
    [oldHash],
  );
  if (result.rows.length === 0) return false;
  const { user_id, family_id } = result.rows[0];
  await storeRefreshToken(user_id, newTokenHash, family_id);
  return true;
}

async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await killTokens(`user_id = $1`, [userId]);
}

const EmailSchema = z.string().trim().toLowerCase().email().max(255);
const PhoneSchema = z.string().min(8).max(20);

const SignupSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(100).optional(),
  // Where the user lives, from the country → city picker. Required: it is
  // the feed origin until GPS is granted.
  countryCode: z.string().trim().length(2),
  city: z.string().trim().min(1).max(100),
  stateCode: z.string().trim().max(10).optional(),
});

const SignupResendSchema = z.object({ email: EmailSchema });

const SignupVerifySchema = z.object({
  email: EmailSchema,
  otp: z.string().regex(/^\d{6}$/),
});

const PasswordResetSchema = z.object({
  email: EmailSchema,
  otp: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  phone: PhoneSchema.optional(),
  email: EmailSchema.optional(),
  password: z.string().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  /** Access + refresh token pair for a user who just proved who they are. */
  async function issueSession(user: { id: string; phone?: string | null }) {
    const token = app.jwt.sign({ sub: user.id, phone: user.phone });
    const refreshToken = crypto.randomBytes(64).toString('hex');
    await storeRefreshToken(user.id, hashToken(refreshToken), crypto.randomUUID());
    return { token, refreshToken };
  }

  function invalidInput(reply: FastifyReply, error: z.ZodError) {
    return reply.status(400).send({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid input', details: error.flatten() },
    });
  }

  const signupExpired = {
    success: false,
    error: { code: ERROR_CODES.SIGNUP_EXPIRED, message: 'The code expired. Please sign up again.' },
  };

  /**
   * Emails a fresh code for a pending sign-up, counting it against the daily
   * allowance. Replies itself on every failure; resolves the sends left after
   * this one, or null when it already replied.
   */
  async function sendSignupCode(
    reply: FastifyReply,
    email: string,
    data: string,
  ): Promise<number | null> {
    const claim = await claimSend(email);
    if (claim.locked) {
      reply.status(429).send(signupLocked(claim.retryAfterSeconds));
      return null;
    }
    const code = generateCode();
    await savePending(email, hashCode(email, code), data);
    if (!(await sendOtpEmail(email, code))) {
      await deletePending(email);
      await refundSend(email);
      reply.status(503).send(OTP_SEND_FAILED);
      return null;
    }
    return claim.sendsLeft;
  }

  // ─── Sign up: step 1, email a code ───────────────────
  // Validates the form and emails a code. The account is created only by
  // /signup/verify, so this touches no database: an address that is already
  // registered is reported after verification, which also keeps this route
  // from revealing who has an account.
  app.post(
    '/signup',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = SignupSchema.safeParse(request.body);
      if (!validation.success) return invalidInput(reply, validation.error);
      const form = validation.data;
      const email = normalizeEmail(form.email);

      // Signup city → coordinates, from the bundled dataset (no database)
      const location = resolveCity(form.countryCode, form.city, form.stateCode);
      if (!location) {
        return reply.status(400).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Unknown city for the selected country' },
        });
      }

      try {
        // Checked before hashing so a locked address costs no bcrypt work
        const lockedFor = await lockSeconds(email);
        if (lockedFor > 0) return reply.status(429).send(signupLocked(lockedFor));

        const pending: PendingSignupData = {
          passwordHash: await bcrypt.hash(form.password, 10),
          displayName: form.displayName,
          countryCode: location.countryCode,
          city: location.name,
          country: location.countryName,
          latitude: location.latitude,
          longitude: location.longitude,
        };
        const sendsLeft = await sendSignupCode(reply, email, JSON.stringify(pending));
        if (sendsLeft === null) return reply;

        return reply.send({
          success: true,
          data: {
            email: maskEmail(email),
            expiresInSeconds: SIGNUP_CODE_TTL_SECONDS,
            maxAttempts: SIGNUP_MAX_ATTEMPTS,
            sendsLeft,
          },
        });
      } catch (err) {
        request.log.error({ err }, 'Sign-up code could not be issued');
        return reply.status(503).send(SIGNUP_UNAVAILABLE);
      }
    },
  );

  // ─── Sign up: resend the code ────────────────────────
  // A new code replaces the old one and restarts the 5 minutes and the
  // attempts. Every send counts toward the daily allowance.
  app.post(
    '/signup/resend',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = SignupResendSchema.safeParse(request.body);
      if (!validation.success) return invalidInput(reply, validation.error);
      const email = normalizeEmail(validation.data.email);

      try {
        const pending = await getPending(email);
        if (!pending) return reply.status(410).send(signupExpired);

        const waited = (Date.now() - pending.sentAt) / 1000;
        if (waited < SIGNUP_RESEND_COOLDOWN_SECONDS) {
          return reply.status(429).send({
            success: false,
            error: {
              code: ERROR_CODES.RATE_LIMITED,
              message: `Please wait ${SIGNUP_RESEND_COOLDOWN_SECONDS} seconds before requesting a new code.`,
            },
          });
        }

        const sendsLeft = await sendSignupCode(reply, email, pending.data);
        if (sendsLeft === null) return reply;

        return reply.send({
          success: true,
          data: { expiresInSeconds: SIGNUP_CODE_TTL_SECONDS, maxAttempts: SIGNUP_MAX_ATTEMPTS, sendsLeft },
        });
      } catch (err) {
        request.log.error({ err }, 'Sign-up code could not be resent');
        return reply.status(503).send(SIGNUP_UNAVAILABLE);
      }
    },
  );

  // ─── Sign up: step 2, verify and create the account ──
  // The only sign-up step that touches the database, and only after the code
  // matched. A third wrong code ends the attempt: the app returns to the
  // filled-in form, and a new code counts toward the daily allowance.
  app.post(
    '/signup/verify',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = SignupVerifySchema.safeParse(request.body);
      if (!validation.success) return invalidInput(reply, validation.error);
      const email = normalizeEmail(validation.data.email);

      let data: PendingSignupData;
      try {
        const pending = await getPending(email);
        if (!pending) return reply.status(410).send(signupExpired);
        const attempts = await recordAttempt(email);
        if (attempts < 0) return reply.status(410).send(signupExpired);

        const correct =
          attempts <= SIGNUP_MAX_ATTEMPTS && codeMatches(email, validation.data.otp, pending.codeHash);
        if (!correct) {
          const attemptsLeft = Math.max(0, SIGNUP_MAX_ATTEMPTS - attempts);
          if (attemptsLeft > 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: ERROR_CODES.INVALID_OTP,
                message: `Wrong code. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
                attemptsLeft,
              },
            });
          }
          await deletePending(email);
          const lockedFor = await lockSeconds(email);
          return reply.status(400).send({
            success: false,
            error: {
              code: ERROR_CODES.SIGNUP_FAILED,
              message: lockedFor > 0
                ? `Too many wrong codes, and all ${SIGNUP_MAX_SENDS_PER_DAY} codes for today are used. Try again in 24 hours.`
                : 'Too many wrong codes. Please try again.',
              retryAfterSeconds: lockedFor,
            },
          });
        }

        // Exactly one request gets to consume a correct code
        if (!(await deletePending(email))) return reply.status(410).send(signupExpired);
        data = JSON.parse(pending.data);
      } catch (err) {
        request.log.error({ err }, 'Sign-up code could not be checked');
        return reply.status(503).send(SIGNUP_UNAVAILABLE);
      }

      // ── Verified: the first database access of this sign-up ──
      const emailTaken = {
        success: false,
        error: { code: ERROR_CODES.EMAIL_EXISTS, message: 'This email is already registered. Please sign in.' },
      };
      if (await findUserByEmail(email)) return reply.status(409).send(emailTaken);

      let user;
      try {
        user = await createUser({
          email,
          emailVerified: true,
          passwordHash: data.passwordHash,
          authProvider: 'email',
          displayName: data.displayName,
          countryCode: data.countryCode,
          city: data.city,
          country: data.country,
          latitude: data.latitude,
          longitude: data.longitude,
          h3Index: geoToH3(data.latitude, data.longitude, 7),
        });
      } catch (err: any) {
        // Unique email: registered in the meantime, or a banned account
        if (err?.code === '23505') return reply.status(409).send(emailTaken);
        throw err;
      }
      await createSubscription(user.id, 'free');
      const session = await issueSession(user);

      return reply.status(201).send({
        success: true,
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            email: user.email,
            displayName: user.display_name,
            onboardingComplete: false,
          },
          ...session,
        },
      });
    },
  );

  // ─── Login ───────────────────────────────────────────
  // Email + password. The address was proven when the account was created,
  // so signing in needs no emailed code.
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = LoginSchema.safeParse(request.body);
    if (!validation.success) return invalidInput(reply, validation.error);

    const data = validation.data;

    if ((data.email || data.phone) && data.password) {
      const user = data.email
        ? await findUserByEmail(normalizeEmail(data.email))
        : await findUserByPhone(data.phone!);
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: {
            code: ERROR_CODES.USER_NOT_FOUND,
            message: data.email
              ? 'No account found with this email address'
              : 'No account found with this phone number',
          },
        });
      }

      if (!user.password_hash) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'This account has no password.' },
        });
      }

      const validPassword = await bcrypt.compare(data.password, user.password_hash);
      if (!validPassword) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.INVALID_PASSWORD, message: 'Incorrect password. Please try again.' },
        });
      }

      const session = await issueSession(user);
      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            email: user.email,
            displayName: user.display_name,
            onboardingComplete: user.onboarding_complete,
          },
          ...session,
        },
      });
    }

    return reply.status(400).send({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Provide an email and password' },
    });
  });

  // ─── Forgot password: email a code ───────────────────
  // Same code rules as sign-up (5 minutes, 3 tries, 3 codes a day, 30 s
  // between sends) under the store's 'reset' scope, so a sign-up in progress
  // for the same address is never touched. An unknown address is answered as
  // login answers it.
  app.post(
    '/password/forgot',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = SignupResendSchema.safeParse(request.body);
      if (!validation.success) return invalidInput(reply, validation.error);
      const email = normalizeEmail(validation.data.email);

      try {
        if (!(await findUserByEmail(email))) {
          return reply.status(401).send({
            success: false,
            error: { code: ERROR_CODES.USER_NOT_FOUND, message: 'No account found with this email address' },
          });
        }

        const earlier = await getPending(email, 'reset');
        if (earlier && (Date.now() - earlier.sentAt) / 1000 < SIGNUP_RESEND_COOLDOWN_SECONDS) {
          return reply.status(429).send({
            success: false,
            error: {
              code: ERROR_CODES.RATE_LIMITED,
              message: `Please wait ${SIGNUP_RESEND_COOLDOWN_SECONDS} seconds before requesting a new code.`,
            },
          });
        }

        const claim = await claimSend(email, 'reset');
        if (claim.locked) return reply.status(429).send(signupLocked(claim.retryAfterSeconds));
        const code = generateCode();
        await savePending(email, hashCode(email, code), '', 'reset');
        if (!(await sendOtpEmail(email, code))) {
          await deletePending(email, 'reset');
          await refundSend(email, 'reset');
          return reply.status(503).send(OTP_SEND_FAILED);
        }

        return reply.send({
          success: true,
          data: { expiresInSeconds: SIGNUP_CODE_TTL_SECONDS, maxAttempts: SIGNUP_MAX_ATTEMPTS, sendsLeft: claim.sendsLeft },
        });
      } catch (err) {
        request.log.error({ err }, 'Password reset code could not be issued');
        return reply.status(503).send(OTP_SEND_FAILED);
      }
    },
  );

  // ─── Forgot password: set a new one ──────────────────
  // The emailed code proves the address. A third wrong code ends it. The new
  // password signs out every other device; the app then signs in with it.
  app.post(
    '/password/reset',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = PasswordResetSchema.safeParse(request.body);
      if (!validation.success) return invalidInput(reply, validation.error);
      const email = normalizeEmail(validation.data.email);
      const codeExpired = {
        success: false,
        error: { code: ERROR_CODES.SIGNUP_EXPIRED, message: 'The code expired. Please request a new one.' },
      };

      try {
        const pending = await getPending(email, 'reset');
        if (!pending) return reply.status(410).send(codeExpired);
        const attempts = await recordAttempt(email, 'reset');
        if (attempts < 0) return reply.status(410).send(codeExpired);

        if (attempts > SIGNUP_MAX_ATTEMPTS || !codeMatches(email, validation.data.otp, pending.codeHash)) {
          const attemptsLeft = Math.max(0, SIGNUP_MAX_ATTEMPTS - attempts);
          if (attemptsLeft > 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: ERROR_CODES.INVALID_OTP,
                message: `Wrong code. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
                attemptsLeft,
              },
            });
          }
          await deletePending(email, 'reset');
          return reply.status(400).send({
            success: false,
            error: { code: ERROR_CODES.SIGNUP_FAILED, message: 'Too many wrong codes. Please request a new one.' },
          });
        }

        // Exactly one request gets to consume a correct code
        if (!(await deletePending(email, 'reset'))) return reply.status(410).send(codeExpired);

        const user = await findUserByEmail(email);
        if (!user) {
          return reply.status(401).send({
            success: false,
            error: { code: ERROR_CODES.USER_NOT_FOUND, message: 'No account found with this email address' },
          });
        }
        const passwordHash = await bcrypt.hash(validation.data.password, 10);
        await query(`UPDATE ${TABLES.USERS} SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, user.id]);
        await revokeAllRefreshTokens(user.id);
        return reply.send({ success: true, data: { reset: true } });
      } catch (err) {
        request.log.error({ err }, 'Password could not be reset');
        return reply.status(503).send({
          success: false,
          error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Could not change the password right now. Please try again.' },
        });
      }
    },
  );

  // ─── Refresh Token ───────────────────────────────────
  // Rotates the refresh token: revokes the old one, issues a new access + refresh pair.
  // If a revoked token is reused (replay attack), the entire family is revoked.
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { refreshToken } = (request.body as any) || {};
      if (!refreshToken || typeof refreshToken !== 'string') {
        return reply.status(400).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Refresh token required.' },
        });
      }

      const payload = await verifyRefreshToken(refreshToken);
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Refresh token expired or revoked. Please login again.' },
        });
      }

      const user = await findUserById(payload.userId);
      if (!user || !user.is_active) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Account not found or deactivated.' },
        });
      }

      // Rotate: revoke old, issue new pair
      const newAccessToken = app.jwt.sign({ sub: user.id, phone: user.phone });
      const newRefreshToken = crypto.randomBytes(64).toString('hex');
      if (payload.graceReuse) {
        // The old token is already revoked; just add the new one to the family.
        await storeRefreshToken(user.id, hashToken(newRefreshToken), payload.familyId);
      } else {
        const rotated = await rotateRefreshToken(refreshToken, hashToken(newRefreshToken));
        if (!rotated) {
          // Lost the race: another refresh with the same token revoked it
          // between our lookup and this update (seen live on 2026-10-19
          // while the database was waking: the app retried, both requests
          // ran, the loser answered 401 and the app signed the user out).
          // Re-check; the grace rule above now treats it as a retry.
          const again = await verifyRefreshToken(refreshToken);
          if (!again) {
            return reply.status(401).send({
              success: false,
              error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Refresh token already used. Please login again.' },
            });
          }
          await storeRefreshToken(user.id, hashToken(newRefreshToken), again.familyId);
        }
      }

      return reply.send({
        success: true,
        data: { token: newAccessToken, refreshToken: newRefreshToken },
      });
    } catch (err) {
      // Anything thrown here is the server's problem (database unreachable or
      // waking up, pool exhausted), not the client's. Answering 401 made the
      // app discard a perfectly good session; a 503 tells it to keep the
      // tokens and try again later.
      request.log.error({ err }, 'Token refresh failed');
      return reply.status(503).send({
        success: false,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Server is busy. Please try again in a moment.' },
      });
    }
  });

  // ─── Delete Account ───────────────────────────────────
  // Permanently deletes the user's account and ALL associated records
  // (profile, photos, preferences, interests, KYC, push tokens, subscription,
  // transactions, likes, duo crews, matches, chats and chat media files),
  // and revokes any active Google Pay autopay subscription/mandate immediately.
  //
  // Design:
  //   - The users row is soft-deleted (PII scrubbed, deleted_at set) purely so
  //     retained records (audit_log) keep a valid reference — the
  //     account no longer exists from the app's perspective: phone/email are
  //     NULLed so the number can be re-registered, and is_active is FALSE so no
  //     profile query returns it.
  //   - Matches (and their messages / chat_media via CASCADE) are hard-deleted,
  //     so the partner's conversation list drops them and opening the chat is
  //     impossible (endpoints 404 on missing/inactive matches).
  //   - Requires an authenticated JWT AND { confirm: true } to prevent
  //     accidental deletion.
  app.delete('/account', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
      });
    }

    const { sub: userId } = request.user as any;
    const body = (request.body || {}) as { confirm?: boolean };
    if (body.confirm !== true) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Provide { confirm: true } to delete your account',
        },
      });
    }

    const user = await findUserById(userId);
    if (!user || user.deleted_at) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Account not found' },
      });
    }

    // The account is about to cease to exist — its Play subscription MUST stop
    // renewing, or Google keeps billing someone who has nothing left to be
    // billed for. Cancel it at Play before deleting anything.
    //
    // DEVELOPER_REQUESTED_STOP_PAYMENTS rather than the user-requested variant:
    // the latter is restorable from Play, and there will be no account to
    // restore into. The user keeps Premium until the period they already paid
    // for runs out, which costs them nothing here.
    //
    // If Play can't be reached, abort the deletion so the user retries rather
    // than ending up with a live subscription on a dead account.
    const ledger = await getSubscription(userId);
    if (ledger?.gateway_subscription_id && !isPlayBillingConfigured()) {
      // Deletion still proceeds — blocking it would strand the user — but this
      // is the one path where a subscription can outlive its account, so it
      // must never happen quietly.
      console.error(
        `[DeleteAccount] Play billing is NOT configured; deleting ${userId} WITHOUT cancelling ` +
          `their subscription. Cancel purchase token ${ledger.gateway_subscription_id} manually.`,
      );
    }
    if (ledger?.gateway_subscription_id && isPlayBillingConfigured()) {
      try {
        await cancelSubscription(ledger.gateway_subscription_id, 'DEVELOPER_REQUESTED_STOP_PAYMENTS');
      } catch (err: any) {
        console.error(`[DeleteAccount] Failed to cancel subscription for ${userId}:`, err?.message || err);
        return reply.status(502).send({
          success: false,
          error: {
            code: ERROR_CODES.PAYMENT_FAILED,
            message: 'Could not cancel your subscription. Please try again.',
          },
        });
      }
    }

    let chatMediaUrls: string[] = [];
    // Partners of the user's active matches, for the free-chat cache below
    let partnerIds: string[] = [];
    try {
      // Revoke all refresh tokens so the user can't use old tokens after deletion
      await revokeAllRefreshTokens(userId);

      await transaction(async (q) => {
        // Chats that either person reported are evidence: they are kept
        // (ended, so neither side can open them) for review and for the
        // authorities where the law requires, and purged by the moderation
        // tool once their reports are resolved (src/admin/moderation.ts).
        // Every other chat goes with the account as before.
        const keptResult = await q<{ id: string }>(
          `SELECT m.id FROM ${TABLES.MATCHES} m
           WHERE (m.user_a_id = $1 OR m.user_b_id = $1)
             AND EXISTS (
               SELECT 1 FROM ${TABLES.USER_REPORTS} r
               WHERE (r.reporter_id = m.user_a_id AND r.reported_id = m.user_b_id)
                  OR (r.reporter_id = m.user_b_id AND r.reported_id = m.user_a_id)
             )`,
          [userId],
        );
        const keptMatchIds = keptResult.rows.map((row) => row.id);

        // Collect chat media files for MinIO cleanup after commit
        const mediaResult = await q(
          `SELECT cm.url, cm.thumbnail_url
           FROM ${TABLES.CHAT_MEDIA} cm
           JOIN ${TABLES.MESSAGES} msg ON msg.id = cm.message_id
           JOIN ${TABLES.MATCHES} m ON m.id = msg.match_id
           WHERE (m.user_a_id = $1 OR m.user_b_id = $1)
             AND NOT (m.id = ANY($2::uuid[]))`,
          [userId, keptMatchIds],
        );
        for (const row of mediaResult.rows) {
          if (row.url) chatMediaUrls.push(row.url);
          if (row.thumbnail_url) chatMediaUrls.push(row.thumbnail_url);
        }

        // A partner whose free chat was with this account has spent it, the
        // same as if they had been unmatched: the next match does not take
        // its place (see services/premiumAccess.ts). Recorded on the partner
        // before the match rows go.
        const partnerRows = await q(
          `UPDATE ${TABLES.USERS} SET free_chat_spent = TRUE
            WHERE free_chat_match_id IN (
              SELECT id FROM ${TABLES.MATCHES} WHERE user_a_id = $1 OR user_b_id = $1
            )
            AND id <> $1 AND free_chat_spent = FALSE
            RETURNING id`,
          [userId],
        );
        partnerIds = partnerRows.rows.map((row: any) => row.id);

        // Matches vanish — messages + chat_media and reservations cascade —
        // except the reported ones kept above, which are only ended
        await q(
          `DELETE FROM ${TABLES.MATCHES}
           WHERE (user_a_id = $1 OR user_b_id = $1) AND NOT (id = ANY($2::uuid[]))`,
          [userId, keptMatchIds],
        );
        if (keptMatchIds.length > 0) {
          await q(`UPDATE ${TABLES.MATCHES} SET is_active = FALSE WHERE id = ANY($1::uuid[])`, [keptMatchIds]);
        }

        // User-owned records
        await q(`DELETE FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_INTERESTS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.KYC_DOCUMENTS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.PUSH_TOKENS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`, [userId]);
        // Duo Wingman was removed, but its table stays until a migration drops it;
        // clearing a user's rows here keeps deletion safe on any database
        await q(`DELETE FROM ${TABLES.DUO_CREWS} WHERE creator_id = $1 OR invitee_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_INTERACTIONS} WHERE actor_id = $1 OR target_id = $1`, [userId]);
        // Blocks go with the account. Reports stay as safety records; the
        // tombstoned user row they point at keeps no personal data.
        await q(`DELETE FROM ${TABLES.USER_BLOCKS} WHERE blocker_id = $1 OR blocked_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.TRANSACTIONS} WHERE user_id = $1`, [userId]);
        // audit_log: retained by design

        // Tombstone the user row — scrub all PII
        await q(
          `UPDATE ${TABLES.USERS} SET
             deleted_at = NOW(),
             is_active = FALSE,
             is_banned = FALSE,
             phone = NULL,
             email = NULL,
             password_hash = NULL,
             auth_provider = NULL,
             auth_provider_id = NULL,
             display_name = NULL,
             date_of_birth = NULL,
             gender = NULL,
             pronouns = NULL,
             bio = NULL,
             occupation = NULL,
             education = NULL,
             latitude = NULL,
             longitude = NULL,
             h3_index = NULL,
             location_updated_at = NULL,
             city = NULL,
             county = NULL,
             region = NULL,
             country = NULL,
             dating_category = NULL,
             about_answers = NULL,
             phone_verified = FALSE,
             email_verified = FALSE,
             kyc_status = 'unverified',
             face_verification_status = 'unverified',
             is_verified = FALSE,
             aadhaar_ref_hash = NULL
           WHERE id = $1`,
          [userId],
        );

        // Audit trail of the deletion itself
        await q(
          `INSERT INTO ${TABLES.AUDIT_LOG} (user_id, action, entity_type, entity_id)
           VALUES ($1, 'account.deleted', 'user', $1)`,
          [userId],
        );
      });

      // ── Post-commit best-effort cleanup (non-critical) ──
      // Partners whose free chat was just spent may still have it cached;
      // drop it so their lock applies at once (never throws).
      await Promise.all(partnerIds.map((partnerId) => invalidateFreeChatCache(partnerId)));
      await deleteAllUserPhotos(userId).catch((err: Error) => {
        console.error(`[DeleteAccount] Failed to delete MinIO photos for ${userId}:`, err.message);
      });
      // The ID document is the most sensitive file we hold; the row went in
      // the transaction above, this removes the file itself.
      await deleteAllUserKycDocuments(userId).catch((err: Error) => {
        console.error(`[DeleteAccount] Failed to delete KYC documents for ${userId}:`, err.message);
      });
      for (const url of chatMediaUrls) {
        const key = chatMediaKeyFromUrl(url);
        if (!key) continue;
        await deleteChatFile(key).catch((err: Error) => {
          console.error(`[DeleteAccount] Failed to delete chat file ${key}:`, err.message);
        });
        // Plain /uploads/ webp files also have a thumbnail
        if (url.startsWith('/uploads/') && key.endsWith('.webp')) {
          const thumbKey = key.replace('.webp', '_thumb.webp');
          await deleteChatFile(thumbKey).catch(() => {});
        }
      }

      await eventBus.sendUserEvent({ type: 'user.deleted', payload: { userId } }).catch((err: Error) => {
        console.error('[DeleteAccount] Failed to publish user.deleted event:', err.message);
      });

      return reply.send({ success: true, data: { deleted: true } });
    } catch (err: any) {
      console.error(`[DeleteAccount] Failed for user ${userId}:`, err?.message || err);
      return reply.status(500).send({
        success: false,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to delete account' },
      });
    }
  });
}
