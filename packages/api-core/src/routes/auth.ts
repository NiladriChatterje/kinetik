import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { ERROR_CODES, transaction, TABLES } from '@kinetik/shared';
import { createUser, findUserByPhone, findUserByEmail, findUserById, createSubscription, updateUser, getSubscription } from '../services/database';
import { deleteAllUserPhotos, deleteChatFile } from '../services/photoStorage';
import { isRazorpayConfigured, fetchSubscription, cancelPremiumSubscription } from '../services/razorpay';
import { eventBus } from '../services/eventBus';
import { sendOtpSms } from '../services/sms';

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
const otpStore = new Map<string, { otp: string; expiresAt: number }>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds

function generateOtp(): string {
  return '123456';
}

async function storeOtp(phone: string): Promise<string> {
  const otp = generateOtp();
  otpStore.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS });
  // Send OTP via SMS (falls back to console.log in dev mode)
  await sendOtpSms(phone, otp);
  return otp;
}

function verifyStoredOtp(phone: string, otp: string): boolean {
  const entry = otpStore.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return false;
  }
  return entry.otp === otp;
}

function canResendOtp(phone: string): boolean {
  const entry = otpStore.get(phone);
  if (!entry) return true;
  return Date.now() - (entry.expiresAt - OTP_TTL_MS) >= RESEND_COOLDOWN_MS;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

const RegisterSchema = z.object({
  phone: z.string().min(8).max(20).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  authProvider: z.enum(['phone', 'google', 'apple']),
  authProviderId: z.string().optional(),
  displayName: z.string().min(1).max(100).optional(),
  age: z.number().int().min(18).max(120),
});

const LoginSchema = z.object({
  phone: z.string().min(8).max(20).optional(),
  email: z.string().email().optional(),
  password: z.string().optional(),
  authProvider: z.enum(['phone', 'google', 'apple']).optional(),
  authProviderId: z.string().optional(),
});

const VerifyOtpSchema = z.object({
  phone: z.string().min(8).max(20),
  otp: z.string().length(6),
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
      passwordHash = await bcrypt.hash(data.password, 12);
    }

    const user = await createUser({
      phone: data.phone,
      email: data.email,
      passwordHash,
      authProvider: data.authProvider,
      authProviderId: data.authProviderId,
      displayName: data.displayName,
      dateOfBirth: data.age
        ? new Date(new Date().setFullYear(new Date().getFullYear() - data.age)).toISOString().split('T')[0]
        : undefined,
    });

    // Generate JWT
    const token = app.jwt.sign({
      sub: user.id,
      phone: user.phone,
    });

    // Create subscription ledger
    await createSubscription(user.id, 'free');

    return reply.status(201).send({
      success: true,
      data: {
        user: { id: user.id, phone: user.phone, email: user.email, displayName: user.display_name },
        token,
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

    // Phone/Password login
    if (data.phone && data.password) {
      const user = await findUserByPhone(data.phone);
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.USER_NOT_FOUND, message: 'No account found with this phone number' },
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
      await storeOtp(user.phone);

      return reply.send({
        success: true,
        data: {
          requiresOtp: true,
          phone: maskPhone(user.phone),
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
  app.post('/send-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ phone: z.string().min(8).max(20) });
    const validation = schema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid phone number' },
      });
    }

    const { phone } = validation.data;

    // Rate limit: check cooldown
    if (!canResendOtp(phone)) {
      return reply.status(429).send({
        success: false,
        error: { code: ERROR_CODES.RATE_LIMITED, message: 'Please wait 30 seconds before requesting a new code.' },
      });
    }

    await storeOtp(phone);

    return reply.send({
      success: true,
      data: { message: 'Verification code sent.' },
    });
  });

  // ─── Verify OTP ──────────────────────────────────────
  app.post('/verify-otp', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const { phone, otp } = validation.data;

    // Verify OTP against stored value
    if (!verifyStoredOtp(phone, otp)) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_OTP, message: 'Invalid or expired verification code.' },
      });
    }

    // OTP is valid — clear it and issue JWT
    otpStore.delete(phone);

    // Find or create user by phone
    let user = await findUserByPhone(phone);
    if (!user) {
      user = await createUser({ phone, authProvider: 'phone' });
      await createSubscription(user.id, 'free');
    }

    // Mark phone as verified
    await updateUser(user.id, { phone_verified: true });

    const token = app.jwt.sign({ sub: user.id, phone: user.phone });
    return reply.send({
      success: true,
      data: {
        user: { id: user.id, phone: user.phone, onboardingComplete: user.onboarding_complete },
        token,
      },
    });
  });

  // ─── Refresh Token ───────────────────────────────────
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user: any = request.user;
      const token = app.jwt.sign({ sub: user.sub, phone: user.phone });
      return reply.send({
        success: true,
        data: { token },
      });
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Token expired. Please login again.' },
      });
    }
  });

  // ─── Delete Account ───────────────────────────────────
  // Permanently deletes the user's account and ALL associated records
  // (profile, photos, preferences, interests, KYC, push tokens, subscription,
  // transactions, likes, duo crews, matches, chats and chat media files),
  // and cancels any active Razorpay subscription/mandate immediately.
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

    // The account is about to cease to exist — its recurring Razorpay
    // subscription/mandate MUST stop charging. Cancel immediately (not at
    // cycle end). If Razorpay can't be reached, abort the deletion so the
    // user retries rather than leaving a live mandate on a dead account.
    const ledger = await getSubscription(userId);
    if (ledger?.razorpay_subscription_id && isRazorpayConfigured()) {
      try {
        const current = await fetchSubscription(ledger.razorpay_subscription_id);
        if (!['cancelled', 'halted', 'completed', 'expired'].includes(current.status)) {
          await cancelPremiumSubscription(ledger.razorpay_subscription_id, false);
        }
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
             liveness_status = 'unverified',
             is_verified = FALSE
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
