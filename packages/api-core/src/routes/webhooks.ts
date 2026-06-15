import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, TABLES } from '../services/database';
import { kafkaProducer } from '../services/kafka';
import { getRedis } from '../services/redis';

export async function webhookRoutes(app: FastifyInstance) {
  // ─── Razorpay Webhook ────────────────────────────────
  // Note: In production, verify webhook signature with razorpay webhook secret
  app.post('/razorpay', async (request: FastifyRequest, reply: FastifyReply) => {
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

          // Store transaction
          await query(
            `INSERT INTO ${TABLES.TRANSACTIONS} 
             (user_id, razorpay_payment_id, razorpay_order_id, amount, currency, status)
             VALUES ($1, $2, $3, $4, $5, 'completed')
             ON CONFLICT DO NOTHING`,
            [payment.receipt || payment.notes?.user_id, payment.id, payment.order_id,
             payment.amount / 100, payment.currency],
          );

          await kafkaProducer.sendPaymentEvent({
            type: 'payment.captured',
            payload: payment,
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
                   expires_at = TO_TIMESTAMP($2), updated_at = NOW()
               WHERE user_id = $3`,
              [subscription.id, subscription.current_end, userId],
            );

            // Clear swipe cache
            const redis = getRedis();
            await redis.del(`user:${userId}:swipes:daily`);
          }

          await kafkaProducer.sendPaymentEvent({
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
               SET tier = 'free', swipe_allowance = 50, updated_at = NOW()
               WHERE user_id = $1`,
              [cancelled.notes.user_id],
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
