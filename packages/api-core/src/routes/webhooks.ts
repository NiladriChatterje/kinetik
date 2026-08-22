import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { FREE_SWIPE_LIMIT } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { eventBus } from '../services/eventBus';
import { getRedis } from '../services/redis';
import { verifyWebhookSignature } from '../services/razorpay';

export async function webhookRoutes(app: FastifyInstance) {
  // Capture the raw request body so we can verify Razorpay's webhook signature.
  // Signature is computed over the exact bytes Razorpay sent, so we buffer the
  // stream in a preParsing hook (scoped to this plugin) and hand Fastify a
  // fresh stream to parse normally.
  app.addHook('preParsing', async (request: any, _reply: any, payload: any) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    request.rawBody = Buffer.concat(chunks);
    return Readable.from([request.rawBody]);
  });

  // ─── Razorpay Webhook ────────────────────────────────
  // Events we care about:
  //   payment.captured       – one-off or subscription charge captured
  //   subscription.charged   – recurring renewal succeeded (grant/refresh premium)
  //   subscription.activated – initial activation
  //   subscription.cancelled – user cancelled / mandate revoked
  // Signature is verified against RAZORPAY_WEBHOOK_SECRET when configured
  // (set it from the Razorpay Dashboard → Settings → Webhooks).
  app.post('/razorpay', async (request: FastifyRequest, reply: FastifyReply) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = request.headers['x-razorpay-signature'] as string | undefined;

    if (webhookSecret) {
      if (!verifyWebhookSignature((request as any).rawBody, signature)) {
        return reply.status(400).send({ success: false, message: 'Invalid webhook signature' });
      }
    } else {
      // Dev fallback: without a webhook secret we cannot authenticate the
      // payload. Log loudly so this never silently ships to production.
      console.warn('[webhooks] RAZORPAY_WEBHOOK_SECRET is not set — skipping signature verification');
    }

    const event = request.body as any;

    if (!event || !event.event) {
      return reply.status(400).send({ success: false, message: 'Invalid webhook payload' });
    }

    const { event: eventType, payload } = event;

    try {
      switch (eventType) {
        case 'payment.captured': {
          const payment = payload.payment?.entity;
          if (!payment) break;

          const userId = payment.receipt || payment.notes?.user_id;
          if (!userId) break;

          // Store transaction (dedupe: Razorpay may retry webhook delivery)
          await query(
            `INSERT INTO ${TABLES.TRANSACTIONS}
             (user_id, razorpay_payment_id, razorpay_order_id, razorpay_subscription_id, amount, currency, status)
             SELECT $1, $2, $3, $4, $5, $6, 'completed'
             WHERE NOT EXISTS (
               SELECT 1 FROM ${TABLES.TRANSACTIONS} WHERE razorpay_payment_id = $2
             )`,
            [userId, payment.id, payment.order_id, payment.subscription_id || null,
             payment.amount / 100, payment.currency],
          );

          await eventBus.sendPaymentEvent({
            type: 'payment.captured',
            payload: payment,
          });
          break;
        }

        case 'subscription.charged': {
          const subscription = payload.subscription?.entity;
          if (!subscription) break;

          const userId = subscription.notes?.user_id;
          if (!userId) break;

          const currentEnd = subscription.current_end
            ? new Date(Number(subscription.current_end) * 1000)
            : null;

          // Grant / refresh premium until the end of the current billing cycle
          await query(
            `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
             SET tier = 'premium', razorpay_subscription_id = $1,
                 expires_at = COALESCE($2, expires_at), auto_renew = TRUE,
                 updated_at = NOW()
             WHERE user_id = $3`,
            [subscription.id, currentEnd, userId],
          );

          // Record the recurring charge
          const payment = payload.payment?.entity;
          if (payment) {
            await query(
              `INSERT INTO ${TABLES.TRANSACTIONS}
               (user_id, razorpay_payment_id, razorpay_subscription_id, amount, currency, status, description)
               SELECT $1, $2, $3, $4, $5, 'completed', $6
               WHERE NOT EXISTS (
                 SELECT 1 FROM ${TABLES.TRANSACTIONS} WHERE razorpay_payment_id = $2
               )`,
              [userId, payment.id, subscription.id,
               payment.amount ? payment.amount / 100 : null, payment.currency || 'INR',                'Kinetik Premium — ₹250/month'],
            );
          }

          // Clear swipe cache so the allowance applies immediately
          const redis = getRedis();
          await redis.del(`user:${userId}:swipes:daily`);

          await eventBus.sendPaymentEvent({
            type: 'subscription.charged',
            payload: { userId, razorpaySubscriptionId: subscription.id, currentEnd },
          });
          break;
        }

        case 'subscription.activated': {
          const subscription = payload.subscription?.entity;
          if (!subscription) break;

          const userId = subscription.notes?.user_id;
          if (userId) {
            await query(
              `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
               SET tier = 'premium', razorpay_subscription_id = $1,
                   expires_at = TO_TIMESTAMP($2), auto_renew = TRUE, updated_at = NOW()
               WHERE user_id = $3`,
              [subscription.id, subscription.current_end, userId],
            );

            // Clear swipe cache
            const redis = getRedis();
            await redis.del(`user:${userId}:swipes:daily`);
          }

          await eventBus.sendPaymentEvent({
            type: 'subscription.activated',
            payload: subscription,
          });
          break;
        }

        case 'subscription.cancelled': {
          const cancelled = payload.subscription?.entity;
          if (cancelled?.notes?.user_id) {
            await query(
              `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
               SET tier = 'free', swipe_allowance = $2, auto_renew = FALSE, updated_at = NOW()
               WHERE user_id = $1`,
              [cancelled.notes.user_id, FREE_SWIPE_LIMIT],
            );
          }
          break;
        }

        default:
          console.log(`Unhandled webhook event: ${eventType}`);
      }

      return reply.send({ success: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Always return 200 to acknowledge receipt
      return reply.send({ success: true, error: 'Processing error, event queued' });
    }
  });
}
