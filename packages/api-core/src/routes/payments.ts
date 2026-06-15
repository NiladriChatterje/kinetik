import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, PREMIUM_SWIPE_LIMIT_DAILY, PREMIUM_MONTHLY_COST_INR, INFINITE_MONTHLY_COST_INR } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { kafkaProducer } from '../services/kafka';
import { getRedis } from '../services/redis';

const CreateOrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
  description: z.string().optional(),
});

const VerifyPaymentSchema = z.object({
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

const SubscribeSchema = z.object({
  tier: z.enum(['premium', 'infinite']),
  planDuration: z.enum(['monthly', 'yearly']).default('monthly'),
});

export async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
      });
    }
  });

  // ─── Create Razorpay Order ───────────────────────────
  app.post('/create-order', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = CreateOrderSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid payment details',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { amount, currency, description } = validation.data;

    // In production, create order via Razorpay API
    // const razorpayOrder = await razorpay.orders.create({ amount, currency, receipt: userId });

    // Store pending order in DB
    const result = await query(
      `INSERT INTO ${TABLES.TRANSACTIONS} (user_id, amount, currency, status, description)
       VALUES ($1, $2, $3, 'created', $4)
       RETURNING id, amount, currency, status, created_at`,
      [userId, amount, currency, description || 'Payment'],
    );

    return reply.send({
      success: true,
      data: {
        transactionId: result.rows[0].id,
        amount: result.rows[0].amount,
        currency: result.rows[0].currency,
        // In production: razorpayOrderId: razorpayOrder.id,
        razorpayOrderId: `order_${result.rows[0].id}`,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  });

  // ─── Verify Payment ──────────────────────────────────
  app.post('/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = VerifyPaymentSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid verification data',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = validation.data;

    // In production, verify signature using Razorpay utility
    // const isValid = razorpay.utils.verifyPaymentSignature({
    //   order_id: razorpayOrderId,
    //   payment_id: razorpayPaymentId,
    //   signature: razorpaySignature,
    // });

    const isValid = true; // Simplified for dev

    if (!isValid) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Payment verification failed' },
      });
    }

    // Update transaction
    await query(
      `UPDATE ${TABLES.TRANSACTIONS} 
       SET razorpay_payment_id = $1, razorpay_order_id = $2, status = 'completed'
       WHERE razorpay_order_id = $3`,
      [razorpayPaymentId, razorpayOrderId, razorpayOrderId],
    );

    await kafkaProducer.sendPaymentEvent({
      type: 'payment.completed',
      payload: { userId, razorpayPaymentId, razorpayOrderId },
    });

    return reply.send({
      success: true,
      data: { verified: true, paymentId: razorpayPaymentId },
    });
  });

  // ─── Create / Update Subscription ────────────────────
  app.post('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = SubscribeSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid subscription data',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { tier, planDuration } = validation.data;

    const amount = tier === 'premium'
      ? (planDuration === 'yearly' ? PREMIUM_MONTHLY_COST_INR * 10 : PREMIUM_MONTHLY_COST_INR)
      : (planDuration === 'yearly' ? INFINITE_MONTHLY_COST_INR * 10 : INFINITE_MONTHLY_COST_INR);

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (planDuration === 'yearly' ? 12 : 1));

    // Update subscription ledger
    await query(
      `UPDATE ${TABLES.SUBSCRIPTION_LEDGER} 
       SET tier = $1, swipe_allowance = $2, expires_at = $3, 
           fast_passes_remaining = $4, rain_checks_remaining = $5,
           updated_at = NOW()
       WHERE user_id = $6`,
      [
        tier,
        tier === 'free' ? 50 : tier === 'premium' ? PREMIUM_SWIPE_LIMIT_DAILY : 999999,
        expiresAt.toISOString(),
        tier === 'free' ? 0 : tier === 'premium' ? 5 : 99,
        tier === 'free' ? 0 : tier === 'premium' ? 3 : 99,
        userId,
      ],
    );

    // Clear Redis swipe cache
    const redis = getRedis();
    await redis.del(`user:${userId}:swipes:daily`);

    await kafkaProducer.sendPaymentEvent({
      type: 'subscription.updated',
      payload: { userId, tier, expiresAt },
    });

    return reply.send({
      success: true,
      data: { tier, expiresAt, amount },
    });
  });
}
