import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'crypto';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils';
import { PREMIUM_MONTHLY_COST_INR } from '@kinetik/shared';

// ─── Razorpay SDK Instance ────────────────────────────────
// Constructed lazily so the server can still boot without credentials
// (local dev / CI). All payment routes surface a friendly error when
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing.

let instance: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (!instance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error(
        'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment.',
      );
    }
    instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return instance;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// ─── Premium Plan ─────────────────────────────────────────
// Plans are reusable templates (amount + billing period). We create the
// ₹100/month plan once and cache its id in memory. To pin an existing plan
// across restarts (recommended in production), set RAZORPAY_PLAN_ID in env.

const PREMIUM_PLAN_PERIOD = 'monthly';
const PREMIUM_SUBSCRIPTION_TOTAL_COUNT = 12; // 1 year of monthly billing cycles

let cachedPlanId: string | null = null;

export async function getOrCreatePremiumPlan(): Promise<string> {
  if (process.env.RAZORPAY_PLAN_ID) {
    return process.env.RAZORPAY_PLAN_ID;
  }
  if (cachedPlanId) {
    return cachedPlanId;
  }

  const razorpay = getRazorpay();
  const plan = await razorpay.plans.create({
    period: PREMIUM_PLAN_PERIOD,
    interval: 1,
    item: {
      name: 'Kinetik Premium',
      description: 'Kinetik Premium — ₹100/month',
      amount: PREMIUM_MONTHLY_COST_INR * 100, // paise
      currency: 'INR',
    },
    notes: { tier: 'premium' },
  });

  cachedPlanId = plan.id;
  return plan.id;
}

// ─── Subscriptions ────────────────────────────────────────

/**
 * Creates a recurring Razorpay subscription for the premium plan.
 * `notes.user_id` is how we correlate webhook events back to the account.
 */
export async function createPremiumSubscription(userId: string) {
  const planId = await getOrCreatePremiumPlan();
  const razorpay = getRazorpay();
  return razorpay.subscriptions.create({
    plan_id: planId,
    total_count: PREMIUM_SUBSCRIPTION_TOTAL_COUNT,
    customer_notify: 1, // Razorpay sends payment reminders / debit alerts
    notes: { user_id: userId },
  });
}

export async function fetchSubscription(subscriptionId: string) {
  const razorpay = getRazorpay();
  return razorpay.subscriptions.fetch(subscriptionId);
}

/**
 * Cancels a subscription. By default Razorpay cancels at the end of the
 * current billing cycle (the customer keeps access until they've paid for),
 * so `cancelAtCycleEnd = true`; pass false to cut access immediately.
 */
export async function cancelPremiumSubscription(subscriptionId: string, cancelAtCycleEnd = true) {
  const razorpay = getRazorpay();
  return razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
}

// ─── Signature Verification ───────────────────────────────

/**
 * Verifies the HMAC returned by the Checkout for a subscription payment:
 *   signature = hmac_sha256(razorpay_payment_id + "|" + subscription_id, key_secret)
 * See https://razorpay.com/docs/payments/subscriptions/integration-guide/#payment-verification
 */
export function verifySubscriptionSignature(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !params.paymentId || !params.subscriptionId || !params.signature) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(`${params.paymentId}|${params.subscriptionId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a Razorpay webhook signature against the raw request body.
 * Requires RAZORPAY_WEBHOOK_SECRET (set from the Razorpay Dashboard).
 * Returns false when the secret is not configured so callers can decide
 * whether to skip verification in dev.
 */
export function verifyWebhookSignature(body: string | Buffer, signature: string | undefined): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) {
    return false;
  }
  try {
    return validateWebhookSignature(body, signature, secret);
  } catch {
    return false;
  }
}

export { PREMIUM_SUBSCRIPTION_TOTAL_COUNT, PREMIUM_PLAN_PERIOD };
