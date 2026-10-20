import { GoogleAuth } from 'google-auth-library';

// ─── Google Play Billing ──────────────────────────────────
// Kinetik Premium is sold as a Play Billing subscription. Google is the
// merchant of record: it shows the purchase sheet, takes the payment method
// the user chose (UPI Autopay, card, Play balance…), holds the recurring
// mandate, retries failed charges, and pays out. There is no PSP, no payment
// token to charge, and nothing for this server to bill.
//
// The server's whole job is:
//   1. verify a purchase token the app hands us            (subscriptionsv2.get)
//   2. acknowledge it within 3 days or Google auto-refunds (…:acknowledge)
//   3. re-check it whenever Google says something changed  (RTDN → 1.)
//
// Configuration (see .env.example):
//   GOOGLE_PLAY_PACKAGE_NAME            com.kinetik.app
//   GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID Play Console subscription product id
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON    service-account key, inline JSON
//   GOOGLE_PLAY_SERVICE_ACCOUNT_FILE    …or a path to the key file
//   GOOGLE_PLAY_RTDN_SECRET             shared secret on the RTDN push URL

const ANDROID_PUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/**
 * States in which the user still gets Premium.
 *
 * CANCELED is deliberately included: the user turned off renewal but has paid
 * through the end of the cycle, and `expiryTime` is what actually ends it.
 * ON_HOLD and PAUSED are deliberately excluded — Google has suspended the
 * subscription and access is supposed to stop until it recovers.
 */
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

/**
 * States in which Google could not charge a renewal: in a grace period the
 * user keeps Premium for a few days, on hold they have lost it. Either way
 * the fix is the payment method in Google Play, and the app says so.
 */
const PAYMENT_ISSUE_STATES = new Set([
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_ON_HOLD',
]);

export function isPaymentIssueState(state: string | null | undefined): boolean {
  return Boolean(state && PAYMENT_ISSUE_STATES.has(state));
}

export const PREMIUM_PLAN_PERIOD = 'weekly';

export function getSubscriptionProductId(): string {
  return process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID || 'kinetik_premium_weekly';
}

function getPackageName(): string {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.kinetik.app';
}

/** Deep link to Play's subscription centre — the only place a Play subscription can be cancelled. */
export function getManageSubscriptionUrl(): string {
  return `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(
    getSubscriptionProductId(),
  )}&package=${encodeURIComponent(getPackageName())}`;
}

function readCredentials(): Record<string, any> | null {
  const inline = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline);
    } catch {
      console.error('[playBilling] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
      return null;
    }
  }
  const file = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (file && file.trim()) {
    try {
      // Required lazily so a missing file cannot break module load.
      const fs = require('fs') as typeof import('fs');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error: any) {
      console.error(`[playBilling] Could not read ${file}:`, error?.message || error);
      return null;
    }
  }
  return null;
}

export function isPlayBillingConfigured(): boolean {
  return Boolean(readCredentials());
}

// google-auth-library caches and refreshes the access token internally, so the
// client is built once and reused.
let authClientPromise: Promise<any> | null = null;

async function getAuthorizedHeaders(): Promise<Record<string, string>> {
  if (!authClientPromise) {
    const credentials = readCredentials();
    if (!credentials) {
      throw new Error('Google Play service account is not configured');
    }
    const auth = new GoogleAuth({ credentials, scopes: [SCOPE] });
    authClientPromise = auth.getClient();
  }
  const client = await authClientPromise;
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error('Could not obtain a Google Play access token');
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export interface PlaySubscription {
  /** True when the user should currently have Premium. */
  entitled: boolean;
  /** End of the paid period — the authority on when access stops. */
  expiresAt: Date | null;
  /** False once the user cancels; they keep access until expiresAt. */
  autoRenewing: boolean;
  productId: string | null;
  /** Play order id for the most recent successful charge — our payment id. */
  orderId: string | null;
  state: string;
  /** True while Google is still waiting for us to acknowledge the purchase. */
  needsAcknowledgement: boolean;
  /** Purchases made by a licence tester are not real money. */
  isTestPurchase: boolean;
}

/**
 * Reads the current server-side truth for a purchase token.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
 */
export async function getSubscriptionPurchase(purchaseToken: string): Promise<PlaySubscription> {
  const headers = await getAuthorizedHeaders();
  const url =
    `${ANDROID_PUBLISHER}/applications/${encodeURIComponent(getPackageName())}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Play subscriptionsv2.get failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data: any = await response.json();
  const state: string = data.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED';

  // A subscription has one line item per product; Kinetik sells a single plan,
  // so the latest expiry across items is the one that matters.
  const lineItems: any[] = Array.isArray(data.lineItems) ? data.lineItems : [];
  let expiresAt: Date | null = null;
  let productId: string | null = null;
  let autoRenewing = false;

  for (const item of lineItems) {
    if (item?.productId && !productId) productId = item.productId;
    if (item?.autoRenewingPlan?.autoRenewEnabled) autoRenewing = true;
    if (item?.expiryTime) {
      const candidate = new Date(item.expiryTime);
      if (!isNaN(candidate.getTime()) && (!expiresAt || candidate > expiresAt)) {
        expiresAt = candidate;
      }
    }
  }

  // State alone is not enough: a CANCELED subscription is still entitled until
  // its expiry passes, and a stale ACTIVE should never outlive its expiry.
  const entitled = ENTITLED_STATES.has(state) && Boolean(expiresAt && expiresAt.getTime() > Date.now());

  return {
    entitled,
    expiresAt,
    autoRenewing,
    productId,
    orderId: data.latestOrderId || null,
    state,
    needsAcknowledgement: data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    isTestPurchase: Boolean(data.testPurchase),
  };
}

/**
 * Tells Google we have granted what the user paid for.
 *
 * MUST happen within three days of purchase or Google refunds the user and
 * revokes the subscription. Acknowledging twice is harmless.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
 */
export async function acknowledgeSubscription(purchaseToken: string): Promise<void> {
  const headers = await getAuthorizedHeaders();
  const url =
    `${ANDROID_PUBLISHER}/applications/${encodeURIComponent(getPackageName())}` +
    `/purchases/subscriptions/${encodeURIComponent(getSubscriptionProductId())}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;

  const response = await fetch(url, { method: 'POST', headers, body: '{}' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Play acknowledge failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

/**
 * Stops a subscription renewing, server-side. The user keeps access until the
 * end of the period they already paid for — this is not a refund.
 *
 * `USER_REQUESTED_STOP_RENEWALS` is restorable: the user can turn renewal back
 * on from Play. `DEVELOPER_REQUESTED_STOP_PAYMENTS` is not, which is what
 * account deletion wants — there will be no account left to restore into.
 *
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel
 */
export async function cancelSubscription(
  purchaseToken: string,
  cancellationType:
    | 'USER_REQUESTED_STOP_RENEWALS'
    | 'DEVELOPER_REQUESTED_STOP_PAYMENTS' = 'USER_REQUESTED_STOP_RENEWALS',
): Promise<void> {
  const headers = await getAuthorizedHeaders();
  const url =
    `${ANDROID_PUBLISHER}/applications/${encodeURIComponent(getPackageName())}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:cancel`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cancellationContext: { cancellationType } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // An already-cancelled or already-expired subscription is the state we
    // wanted, so don't turn it into a failure the caller has to handle.
    if (response.status === 400 && /already|not active|expired/i.test(body)) {
      return;
    }
    throw new Error(`Play cancel failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

// ─── Real-time developer notifications ────────────────────

export interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: { version?: string; notificationType: number; purchaseToken: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId?: string; productType?: number };
  testNotification?: { version?: string };
}

/** Human-readable names for the notificationType integers, for logging. */
export const SUBSCRIPTION_NOTIFICATION_TYPES: Record<number, string> = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  7: 'SUBSCRIPTION_RESTARTED',
  9: 'SUBSCRIPTION_DEFERRED',
  10: 'SUBSCRIPTION_PAUSED',
  11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
  20: 'SUBSCRIPTION_PENDING_PURCHASE_CANCELED',
};

/**
 * Unwraps the Pub/Sub push envelope:
 *   { message: { data: "<base64 DeveloperNotification>", messageId }, subscription }
 * Returns null when the body is not a notification we can read.
 * https://developer.android.com/google/play/billing/rtdn-reference
 */
export function decodeRtdnMessage(
  body: any,
): { notification: DeveloperNotification; messageId: string | null } | null {
  const data = body?.message?.data;
  if (typeof data !== 'string') return null;
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    return { notification: JSON.parse(decoded), messageId: body?.message?.messageId ?? null };
  } catch {
    return null;
  }
}

/**
 * Guards the RTDN endpoint with a shared secret carried on the push URL
 * (`?secret=…`), which is how Cloud Pub/Sub push subscriptions authenticate to
 * an endpoint that isn't behind IAP. Returns false when unconfigured so the
 * caller can refuse rather than silently trust the payload.
 */
export function verifyRtdnSecret(provided: string | undefined): boolean {
  const expected = process.env.GOOGLE_PLAY_RTDN_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  // Lengths match, so timingSafeEqual is safe to call.
  const { timingSafeEqual } = require('crypto') as typeof import('crypto');
  return timingSafeEqual(a, b);
}
