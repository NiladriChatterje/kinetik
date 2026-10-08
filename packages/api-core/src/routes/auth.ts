import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { ERROR_CODES, transaction, TABLES, geoToH3 } from '@kinetik/shared';
import { createUser, findUserByPhone, findUserByEmail, findUserById, createSubscription, updateUser, getSubscription, query } from '../services/database';
import { deleteAllUserPhotos, deleteAllUserKycDocuments, deleteChatFile } from '../services/photoStorage';
import { isPlayBillingConfigured, cancelSubscription } from '../services/playBilling';
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

// ─── In-memory OTP store (dev only; replace with Redis in production) ──
// A code is addressed to a channel + identifier pair: email (Brevo) or phone
// (no SMS provider, so phone codes are only logged in development). Entries are keyed "email:alice@example.com" / "phone:+9199…" so
// the two channels never collide.
type OtpChannel = 'email' | 'phone';
interface OtpTarget {
  channel: OtpChannel;
  value: string;
}

const otpStore = new Map<string, { otp: string; expiresAt: number; attempts: number }>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
// Six digits is a million possibilities; without a cap the 5-minute window is
// enough to brute-force. After this many wrong guesses the code is discarded.
const OTP_MAX_ATTEMPTS = 5;

function otpKey(target: OtpTarget): string {
  return `${target.channel}:${target.value}`;
}

/** Lowercase + trim so "Alice@Example.com " and "alice@example.com" are one account. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Random 6-digit code when Brevo is configured to email it. Otherwise (no
 * Brevo, or a phone number, which has no provider) the code is only logged, so
 * it stays the fixed 123456 documented in FREE_HOSTING_GUIDE.md for testing.
 */
function generateOtp(channel: OtpChannel): string {
  if (channel === 'phone' || !isEmailConfigured()) return '123456';
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Generate, store and deliver a code. Resolves false when delivery failed
 * (Brevo cap reached, network error) — the entry is dropped so a stale code
 * cannot linger, and the caller should ask the user to retry.
 */
async function storeOtp(target: OtpTarget): Promise<boolean> {
  // Phone codes cannot be delivered, and the logged fallback is the fixed
  // 123456: accepting it in production would let anyone sign in as any phone
  // number. The app signs in by email only, so refuse instead.
  if (target.channel === 'phone' && process.env.NODE_ENV === 'production') {
    return false;
  }

  const otp = generateOtp(target.channel);
  const key = otpKey(target);
  otpStore.set(key, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

  let sent: boolean;
  if (target.channel === 'email') {
    sent = await sendOtpEmail(target.value, otp);
  } else {
    console.log(`[OTP] DEV MODE — code for ${maskPhone(target.value)}: ${otp}`);
    sent = true;
  }

  if (!sent) otpStore.delete(key);
  return sent;
}

function verifyStoredOtp(target: OtpTarget, otp: string): boolean {
  const key = otpKey(target);
  const entry = otpStore.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return false;
  }

  entry.attempts += 1;
  const expected = Buffer.from(entry.otp);
  const given = Buffer.from(otp);
  const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);

  if (!matches && entry.attempts >= OTP_MAX_ATTEMPTS) {
    // Too many wrong guesses: the user has to request a fresh code
    otpStore.delete(key);
  }
  return matches;
}

function canResendOtp(target: OtpTarget): boolean {
  const entry = otpStore.get(otpKey(target));
  if (!entry) return true;
  return Date.now() - (entry.expiresAt - OTP_TTL_MS) >= RESEND_COOLDOWN_MS;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

/**
 * Resolve the OTP target from a request body carrying `email` or `phone`.
 * Email is normalized here so every lookup and store uses the same key.
 */
function otpTargetFromBody(body: { email?: string; phone?: string }): OtpTarget {
  if (body.email) return { channel: 'email', value: normalizeEmail(body.email) };
  return { channel: 'phone', value: body.phone! };
}

const OTP_SEND_FAILED = {
  success: false,
  error: {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Could not send the verification code right now. Please try again in a minute.',
  },
};

// ─── Refresh Token Helpers ───────────────────────────────────
// A signed-in user stays signed in until they sign out, uninstall, or the
// account/database is removed. Each refresh rotates to a fresh token with a
// fresh expiry, so this is only a ceiling on a device that never comes back.
const REFRESH_TOKEN_TTL_DAYS = 3650;

// A token that was just rotated may be presented again when the response
// carrying its successor was lost (network drop, app killed mid-refresh) or
// when two refreshes race. Inside this window that is treated as a retry and
// a new pair is issued; outside it, it is treated as replay and the whole
// family is revoked.
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

async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; familyId: string; graceReuse: boolean } | null> {
  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT user_id, family_id, revoked_at, expires_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;

  // Token expired
  if (new Date(row.expires_at) < new Date()) return null;

  if (row.revoked_at) {
    // Rotated moments ago: the client most likely never received the
    // successor. Let it through once more as a retry.
    const revokedAgo = Date.now() - new Date(row.revoked_at).getTime();
    if (revokedAgo >= 0 && revokedAgo < REFRESH_REUSE_GRACE_MS) {
      return { userId: row.user_id, familyId: row.family_id, graceReuse: true };
    }

    // Token was revoked well before this — possible replay attack, revoke entire family
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [row.family_id],
    );
    return null;
  }

  return { userId: row.user_id, familyId: row.family_id, graceReuse: false };
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
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

const EmailSchema = z.string().trim().toLowerCase().email().max(255);
const PhoneSchema = z.string().min(8).max(20);

const RegisterSchema = z
  .object({
    phone: PhoneSchema.optional(),
    email: EmailSchema.optional(),
    password: z.string().min(8).max(128).optional(),
    authProvider: z.enum(['phone', 'email', 'google', 'apple']),
    authProviderId: z.string().optional(),
    displayName: z.string().min(1).max(100).optional(),
    // Where the user lives, from the country → city picker. Required: it is
    // the feed origin until GPS is granted.
    countryCode: z.string().trim().length(2),
    city: z.string().trim().min(1).max(100),
    stateCode: z.string().trim().max(10).optional(),
  })
  .refine((d) => !!d.phone || !!d.email, {
    message: 'Provide an email address or a phone number',
    path: ['email'],
  });

const LoginSchema = z.object({
  phone: PhoneSchema.optional(),
  email: EmailSchema.optional(),
  password: z.string().optional(),
  authProvider: z.enum(['phone', 'email', 'google', 'apple']).optional(),
  authProviderId: z.string().optional(),
});

// Exactly one of email / phone identifies where the code goes.
const OtpTargetSchema = z
  .object({
    email: EmailSchema.optional(),
    phone: PhoneSchema.optional(),
  })
  .refine((d) => (d.email ? 1 : 0) + (d.phone ? 1 : 0) === 1, {
    message: 'Provide either an email address or a phone number',
    path: ['email'],
  });

const SendOtpSchema = OtpTargetSchema;

const VerifyOtpSchema = z
  .object({
    email: EmailSchema.optional(),
    phone: PhoneSchema.optional(),
    otp: z.string().length(6),
  })
  .refine((d) => (d.email ? 1 : 0) + (d.phone ? 1 : 0) === 1, {
    message: 'Provide either an email address or a phone number',
    path: ['email'],
  });

export async function authRoutes(app: FastifyInstance) {
  // ─── Register ────────────────────────────────────────
  app.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = RegisterSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid input',
          details: validation.error.flatten(),
        },
      });
    }

    const data = validation.data;

    // Check if phone or email already exists
    if (data.phone) {
      const existing = await findUserByPhone(data.phone);
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: ERROR_CODES.PHONE_EXISTS, message: 'Phone number already registered' },
        });
      }
    }

    if (data.email) {
      const existing = await findUserByEmail(data.email);
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: ERROR_CODES.EMAIL_EXISTS, message: 'Email already registered' },
        });
      }
    }

    // Hash password if provided
    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    }

    // Signup city → coordinates. Seeds the location columns so the feed has an
    // origin before (or without) GPS; the first location update overwrites them.
    const location = resolveCity(data.countryCode, data.city, data.stateCode);
    if (!location) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Unknown city for the selected country' },
      });
    }

    const user = await createUser({
      phone: data.phone,
      email: data.email,
      passwordHash,
      authProvider: data.authProvider,
      authProviderId: data.authProviderId,
      displayName: data.displayName,
      countryCode: location.countryCode,
      city: location.name,
      country: location.countryName,
      latitude: location.latitude,
      longitude: location.longitude,
      h3Index: geoToH3(location.latitude, location.longitude, 7),
    });

    // Generate JWT access token
    const token = app.jwt.sign({
      sub: user.id,
      phone: user.phone,
    });

    // Generate refresh token
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const familyId = crypto.randomUUID();
    await storeRefreshToken(user.id, hashToken(refreshToken), familyId);

    // Create subscription ledger
    await createSubscription(user.id, 'free');

    return reply.status(201).send({
      success: true,
      data: {
        user: { id: user.id, phone: user.phone, email: user.email, displayName: user.display_name },
        token,
        refreshToken,
      },
    });
  });

  // ─── Login ───────────────────────────────────────────
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = LoginSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid input',
          details: validation.error.flatten(),
        },
      });
    }

    const data = validation.data;

    // Password login (email or phone) — valid credentials still require a
    // one-time code on the same channel before a session is issued.
    if ((data.email || data.phone) && data.password) {
      const target = otpTargetFromBody(data);
      const user =
        target.channel === 'email'
          ? await findUserByEmail(target.value)
          : await findUserByPhone(target.value);
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: {
            code: ERROR_CODES.USER_NOT_FOUND,
            message:
              target.channel === 'email'
                ? 'No account found with this email address'
                : 'No account found with this phone number',
          },
        });
      }

      // Guard: OTP-only users have no password
      if (!user.password_hash) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Please login using OTP verification' },
        });
      }

      const validPassword = await bcrypt.compare(data.password, user.password_hash);
      if (!validPassword) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.INVALID_PASSWORD, message: 'Incorrect password. Please try again.' },
        });
      }

      // Credentials are valid — generate OTP and require verification
      const sent = await storeOtp(target);
      if (!sent) return reply.status(503).send(OTP_SEND_FAILED);

      return reply.send({
        success: true,
        data: {
          requiresOtp: true,
          ...(target.channel === 'email'
            ? { email: maskEmail(target.value) }
            : { phone: maskPhone(target.value) }),
          userId: user.id,
        },
      });
    }

    // OAuth login
    if (data.authProvider && data.authProviderId) {
      const user = await findUserByEmail(data.email || '');
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'No account found. Please register.' },
        });
      }

      const token = app.jwt.sign({ sub: user.id, phone: user.phone });
      return reply.send({
        success: true,
        data: {
          user: { id: user.id, phone: user.phone, email: user.email, displayName: user.display_name },
          token,
        },
      });
    }

    return reply.status(400).send({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Provide phone+password or authProvider+authProviderId' },
    });
  });

  // ─── Send OTP (resend) ─────────────────────────────────
  // Sending is free for the caller to trigger but spends the Brevo daily
  // quota (300 on the free plan), so this route is throttled per IP on top of
  // the per-identifier cooldown below.
  app.post(
    '/send-otp',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = SendOtpSchema.safeParse(request.body);
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid email address or phone number',
            details: validation.error.flatten(),
          },
        });
      }

      const target = otpTargetFromBody(validation.data);

      // Rate limit: check cooldown
      if (!canResendOtp(target)) {
        return reply.status(429).send({
          success: false,
          error: { code: ERROR_CODES.RATE_LIMITED, message: 'Please wait 30 seconds before requesting a new code.' },
        });
      }

      const sent = await storeOtp(target);
      if (!sent) return reply.status(503).send(OTP_SEND_FAILED);

      return reply.send({
        success: true,
        data: { message: 'Verification code sent.' },
      });
    },
  );

  // ─── Verify OTP ──────────────────────────────────────
  app.post(
    '/verify-otp',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = VerifyOtpSchema.safeParse(request.body);
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid input',
            details: validation.error.flatten(),
          },
        });
      }

      const { otp } = validation.data;
      const target = otpTargetFromBody(validation.data);

      // Verify OTP against stored value
      if (!verifyStoredOtp(target, otp)) {
        return reply.status(400).send({
          success: false,
          error: { code: ERROR_CODES.INVALID_OTP, message: 'Invalid or expired verification code.' },
        });
      }

      // OTP is valid — clear it and issue JWT
      otpStore.delete(otpKey(target));

      // Find or create the user behind the verified identifier
      let user =
        target.channel === 'email'
          ? await findUserByEmail(target.value)
          : await findUserByPhone(target.value);
      if (!user) {
        user =
          target.channel === 'email'
            ? await createUser({ email: target.value, authProvider: 'email' })
            : await createUser({ phone: target.value, authProvider: 'phone' });
        await createSubscription(user.id, 'free');
      }

      // Mark the channel as verified
      await updateUser(user.id, target.channel === 'email' ? { email_verified: true } : { phone_verified: true });

      const token = app.jwt.sign({ sub: user.id, phone: user.phone });

      // Generate refresh token
      const refreshToken = crypto.randomBytes(64).toString('hex');
      const familyId = crypto.randomUUID();
      await storeRefreshToken(user.id, hashToken(refreshToken), familyId);

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            email: user.email,
            onboardingComplete: user.onboarding_complete,
          },
          token,
          refreshToken,
        },
      });
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
          return reply.status(401).send({
            success: false,
            error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Refresh token already used. Please login again.' },
          });
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
    try {
      // Revoke all refresh tokens so the user can't use old tokens after deletion
      await revokeAllRefreshTokens(userId);

      await transaction(async (q) => {
        // Collect chat media files for MinIO cleanup after commit
        const mediaResult = await q(
          `SELECT cm.url, cm.thumbnail_url
           FROM ${TABLES.CHAT_MEDIA} cm
           JOIN ${TABLES.MESSAGES} msg ON msg.id = cm.message_id
           JOIN ${TABLES.MATCHES} m ON m.id = msg.match_id
           WHERE m.user_a_id = $1 OR m.user_b_id = $1`,
          [userId],
        );
        for (const row of mediaResult.rows) {
          if (row.url) chatMediaUrls.push(row.url);
          if (row.thumbnail_url) chatMediaUrls.push(row.thumbnail_url);
        }

        // Matches vanish — messages + chat_media and reservations cascade
        await q(`DELETE FROM ${TABLES.MATCHES} WHERE user_a_id = $1 OR user_b_id = $1`, [userId]);

        // User-owned records
        await q(`DELETE FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_INTERESTS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.KYC_DOCUMENTS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.PUSH_TOKENS} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.DUO_CREWS} WHERE creator_id = $1 OR invitee_id = $1`, [userId]);
        await q(`DELETE FROM ${TABLES.USER_INTERACTIONS} WHERE actor_id = $1 OR target_id = $1`, [userId]);
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
