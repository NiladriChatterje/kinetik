import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { ERROR_CODES } from '@kinetik/shared';
import { createUser, findUserByPhone, findUserByEmail, createSubscription, updateUser } from '../services/database';

// ─── In-memory OTP store (dev only; replace with Redis in production) ──
const otpStore = new Map<string, { otp: string; expiresAt: number }>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOtp(phone: string): string {
  const otp = generateOtp();
  otpStore.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS });
  console.log(`[OTP] Generated for ${phone.slice(0, 4)}***: ${otp}`);
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
      storeOtp(user.phone);

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

    storeOtp(phone);

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
}
