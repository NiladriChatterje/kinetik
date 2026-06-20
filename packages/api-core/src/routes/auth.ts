import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { ERROR_CODES } from '@kinetik/shared';
import { createUser, findUserByPhone, findUserByEmail, createSubscription, updateUser } from '../services/database';

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
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid credentials' },
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
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid credentials' },
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

    // In production, verify OTP against SMS provider or Redis
    // For dev, accept any 6-digit OTP
    if (otp.length !== 6) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_OTP, message: 'Invalid OTP' },
      });
    }

    // Find or create user by phone
    let user = await findUserByPhone(phone);
    if (!user) {
      // Auto-create user on OTP verification (simplified)
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
