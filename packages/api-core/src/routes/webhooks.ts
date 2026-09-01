import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  decodeRtdnMessage,
  verifyRtdnSecret,
  getSubscriptionPurchase,
  acknowledgeSubscription,
  SUBSCRIPTION_NOTIFICATION_TYPES,
} from '../services/playBilling';
import { applyPlayEntitlement, findUserByPurchaseToken } from '../services/subscriptionEntitlement';

export async function webhookRoutes(app: FastifyInstance) {
  // ─── Google Play Real-time Developer Notifications ───
  // Cloud Pub/Sub pushes here whenever a subscription changes state: renewed,
  // cancelled, expired, recovered from account hold, refunded, and so on.
  //
  // The notification itself carries almost nothing — a type and a purchase
  // token. Google's guidance is to treat it purely as a signal and re-read the
  // authoritative state from the Developer API, which is what we do, so every
  // event type converges on the same code path and unknown future types are
  // handled correctly by default.
  //
  // https://developer.android.com/google/play/billing/rtdn-reference
  app.post('/play', async (request: FastifyRequest, reply: FastifyReply) => {
    // Pub/Sub push subscriptions can carry a shared secret in the URL. Without
    // it anyone who finds this path could drive entitlement changes.
    const provided = (request.query as any)?.secret as string | undefined;
    if (!verifyRtdnSecret(provided)) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }

    const decoded = decodeRtdnMessage(request.body);
    if (!decoded) {
      // Malformed — 400 so Pub/Sub stops redelivering it.
      return reply.status(400).send({ success: false, message: 'Unreadable notification' });
    }

    const { notification, messageId } = decoded;

    // Sent from Play Console when you first wire the topic up.
    if (notification.testNotification) {
      console.log('[rtdn] Test notification received — Pub/Sub delivery is working');
      return reply.send({ success: true });
    }

    const purchaseToken =
      notification.subscriptionNotification?.purchaseToken ??
      notification.voidedPurchaseNotification?.purchaseToken;

    if (!purchaseToken) {
      // A one-time product or a type we don't sell. Ack it so it isn't retried.
      return reply.send({ success: true });
    }

    const typeName = notification.subscriptionNotification
      ? SUBSCRIPTION_NOTIFICATION_TYPES[notification.subscriptionNotification.notificationType] ??
        `UNKNOWN_${notification.subscriptionNotification.notificationType}`
      : 'VOIDED_PURCHASE';

    try {
      const userId = await findUserByPurchaseToken(purchaseToken);
      if (!userId) {
        // The purchase exists at Google but no account claims it yet — the app
        // may not have called /subscription/verify. Nothing to update; that
        // call will read the current state itself.
        console.warn(`[rtdn] ${typeName} for an unknown purchase token (message ${messageId})`);
        return reply.send({ success: true });
      }

      const playSub = await getSubscriptionPurchase(purchaseToken);
      await applyPlayEntitlement(userId, purchaseToken, playSub);

      // A purchase that completes after a pending UPI mandate still has to be
      // acknowledged within three days, and this notification may be the first
      // time it is acknowledgeable.
      if (playSub.entitled && playSub.needsAcknowledgement) {
        try {
          await acknowledgeSubscription(purchaseToken);
        } catch (error: any) {
          console.error('[rtdn] Acknowledgement failed:', error?.message || error);
        }
      }

      console.log(
        `[rtdn] ${typeName} → user ${userId} is now ${playSub.entitled ? 'premium' : 'free'} (${playSub.state})`,
      );
      return reply.send({ success: true });
    } catch (error: any) {
      console.error(`[rtdn] Failed to process ${typeName}:`, error?.message || error);
      // 500 makes Pub/Sub redeliver with backoff, which is what we want for a
      // transient Play API or database failure — the handler is idempotent.
      return reply.status(500).send({ success: false, message: 'Processing failed' });
    }
  });
}
