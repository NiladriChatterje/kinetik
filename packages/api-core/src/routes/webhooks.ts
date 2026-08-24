import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { FREE_SWIPE_LIMIT } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { eventBus } from '../services/eventBus';
import { getRedis } from '../services/redis';
import { verifyWebhookSignature } from '../services/googlePay';

export async function webhookRoutes(app: FastifyInstance) {
  // Capture the raw request body so we can verify the webhook signature.
  // Signature is computed over the exact bytes the gateway sent, so we buffer
  // the stream in a preParsing hook (scoped to this plugin) and hand Fastify a
  // fresh stream to parse normally.
  app.addHook('preParsing', async (request: any, _reply: any, payload: any) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    request.rawBody = Buffer.concat(chunks);
    return Readable.from([request.rawBody]);
  });

  // ─── Payments Webhook ────────────────────────────────
  // Posted by the payment gateway that executes the Google Pay autopay
  // mandate charges. Events we care about:
  //   payment.captured       – one-off or subscription charge captured
  //   subscription.charged   – recurring renewal succeeded (grant/refresh premium)
  //   subscription.activated – mandate registered / initial activation
  //   subscription.cancelled – user cancelled / mandate revoked
  // Expected payload shape (flat, gateway-neutral):
  //   { event, payload: { userId, subscriptionId?, paymentId?, orderId?,
  //                       amount?, currency?, currentEnd? } }
  // Signature: hex hmac_sha256(rawBody, PAYMENT_WEBHOOK_SECRET) in the
  // `x-payment-signature` header, verified when the secret is configured.
  app.post('/payments', async (request: FastifyRequest, reply: FastifyReply) => {
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const signature = request.headers['x-payment-signature'] as string | undefined;

    if (webhookSecret) {
      if (!verifyWebhookSignature((request as any).rawBody, signature)) {
        return reply.status(400).send({ success: false, message: 'Invalid webhook signature' });
      }
    } else {
      // Dev fallback: without a webhook secret we cannot authenticate the
      // payload. Log loudly so this never silently ships to production.
      console.warn('[webhooks] PAYMENT_WEBHOOK_SECRET is not set — skipping signature verification');
    }

    const event = request.body as any;

    if (!event || !event.event) {
      return reply.status(400).send({ success: false, message: 'Invalid webhook payload' });
    }

    const { event: eventType, payload } = event;
    const data = payload || {};

    try {
      switch (eventType) {
        case 'payment.captured': {
          const { userId, paymentId } = data;
          if (!userId || !paymentId) break;

          // Store transaction (dedupe: the gateway may retry webhook delivery)
          await query(
            `INSERT INTO ${TABLES.TRANSACTIONS}
             (user_id, gateway_payment_id, gateway_order_id, gateway_subscription_id, amount, currency, status)
             SELECT $1, $2, $3, $4, $5, $6, 'completed'
             WHERE NOT EXISTS (
               SELECT 1 FROM ${TABLES.TRANSACTIONS} WHERE gateway_payment_id = $2
             )`,
            [userId, paymentId, data.orderId || null, data.subscriptionId || null,
             data.amount ?? null, data.currency || 'INR'],
          );

          await eventBus.sendPaymentEvent({
            type: 'payment.captured',
            payload: data,
          });
          break;
        }

        case 'subscription.charged': {
          const { userId, subscriptionId } = data;
          if (!userId || !subscriptionId) break;

          const currentEnd = data.currentEnd ? new Date(data.currentEnd) : null;

          // Grant / refresh premium until the end of the current billing cycle
          await query(
            `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
             SET tier = 'premium', gateway_subscription_id = $1,
                 expires_at = COALESCE($2, expires_at), auto_renew = TRUE,
                 updated_at = NOW()
             WHERE user_id = $3`,
            [subscriptionId, currentEnd, userId],
          );

          // Record the recurring charge
          if (data.paymentId) {
            await query(
              `INSERT INTO ${TABLES.TRANSACTIONS}
               (user_id, gateway_payment_id, gateway_subscription_id, amount, currency, status, description)
               SELECT $1, $2, $3, $4, $5, 'completed', $6
               WHERE NOT EXISTS (
                 SELECT 1 FROM ${TABLES.TRANSACTIONS} WHERE gateway_payment_id = $2
               )`,
              [userId, data.paymentId, subscriptionId,
               data.amount ?? null, data.currency || 'INR', 'Kinetik Premium — monthly renewal'],
            );
          }

          // Clear swipe cache so the allowance applies immediately
          const redis = getRedis();
          await redis.del(`user:${userId}:swipes:daily`);

          await eventBus.sendPaymentEvent({
            type: 'subscription.charged',
            payload: { userId, subscriptionId, currentEnd },
          });
          break;
        }

        case 'subscription.activated': {
          const { userId, subscriptionId } = data;
          if (userId && subscriptionId) {
            const currentEnd = data.currentEnd ? new Date(data.currentEnd) : null;
            await query(
              `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
               SET tier = 'premium', gateway_subscription_id = $1,
                   expires_at = COALESCE($2, expires_at), auto_renew = TRUE, updated_at = NOW()
               WHERE user_id = $3`,
              [subscriptionId, currentEnd, userId],
            );

            // Clear swipe cache
            const redis = getRedis();
            await redis.del(`user:${userId}:swipes:daily`);
          }

          await eventBus.sendPaymentEvent({
            type: 'subscription.activated',
            payload: data,
          });
          break;
        }

        case 'subscription.cancelled': {
          if (data.userId) {
            await query(
              `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
               SET tier = 'free', swipe_allowance = $2, auto_renew = FALSE, updated_at = NOW()
               WHERE user_id = $1`,
              [data.userId, FREE_SWIPE_LIMIT],
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
