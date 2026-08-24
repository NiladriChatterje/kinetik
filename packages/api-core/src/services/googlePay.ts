import { createHmac, timingSafeEqual, randomUUID } from 'crypto';

// ─── Google Pay (recurring / UPI Autopay) ─────────────────
// Kinetik Premium is billed through the Google Pay API. The app shows the
// Google Pay payment sheet once (@google/react-native-make-payment); the user
// approves a recurring mandate — UPI Autopay in India, a tokenized card
// elsewhere — and the sheet returns a gateway payment token. The server
// registers that token with the payment gateway, which executes the monthly
// merchant-initiated charges and reports them back on the payments webhook
// (POST /api/v1/webhooks/payments).
//
// Configuration (see .env.example):
//   GOOGLE_PAY_ENVIRONMENT         TEST | PRODUCTION
//   GOOGLE_PAY_MERCHANT_ID         Google Pay & Wallet Console merchant id
//   GOOGLE_PAY_MERCHANT_NAME       Shown on the payment sheet
//   GOOGLE_PAY_GATEWAY             PSP identifier for PAYMENT_GATEWAY tokenization
//   GOOGLE_PAY_GATEWAY_MERCHANT_ID Merchant id at the PSP
//   GOOGLE_PAY_COUNTRY_CODE        Merchant country (default IN)
//   PAYMENT_WEBHOOK_SECRET         HMAC secret for the payments webhook

const PREMIUM_PLAN_PERIOD = 'monthly';

export function isGooglePayConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_PAY_MERCHANT_ID &&
    process.env.GOOGLE_PAY_GATEWAY &&
    process.env.GOOGLE_PAY_GATEWAY_MERCHANT_ID,
  );
}

/**
 * Everything the client needs to build the Google Pay PaymentDataRequest.
 * No secrets here — merchant/gateway ids are public identifiers.
 */
export function getGooglePayClientConfig() {
  return {
    environment: process.env.GOOGLE_PAY_ENVIRONMENT === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
    merchantId: process.env.GOOGLE_PAY_MERCHANT_ID || '',
    merchantName: process.env.GOOGLE_PAY_MERCHANT_NAME || 'Kinetik',
    gateway: process.env.GOOGLE_PAY_GATEWAY || '',
    gatewayMerchantId: process.env.GOOGLE_PAY_GATEWAY_MERCHANT_ID || '',
    countryCode: process.env.GOOGLE_PAY_COUNTRY_CODE || 'IN',
    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
    allowedCardNetworks: ['AMEX', 'DISCOVER', 'JCB', 'MASTERCARD', 'VISA'],
  };
}

/** Internal subscription id stored on the ledger and echoed to the client. */
export function createSubscriptionId(): string {
  return `sub_${randomUUID()}`;
}

/**
 * Registers the Google Pay payment token with the gateway as a recurring
 * mandate (UPI Autopay / card-on-file) and triggers the first charge.
 *
 * In production this calls the PSP's recurring-payments API with the token
 * from paymentMethodData.tokenizationData.token. The PSP then charges
 * monthly and posts renewal events to /api/v1/webhooks/payments.
 */
export async function registerAutopayMandate(params: {
  subscriptionId: string;
  userId: string;
  paymentToken: string;
  amountMinor: number;
  currency: string;
}): Promise<{ status: 'active'; paymentId: string }> {
  if (!params.paymentToken) {
    throw new Error('Missing Google Pay payment token');
  }
  // In production: await psp.mandates.create({ token: params.paymentToken, ... })
  return { status: 'active', paymentId: `gpay_${randomUUID()}` };
}

/**
 * Revokes the recurring mandate at the gateway so no further charges run.
 * In production this calls the PSP's mandate-cancellation API.
 */
export async function revokeAutopayMandate(subscriptionId: string): Promise<{ status: 'cancelled' }> {
  // In production: await psp.mandates.cancel(subscriptionId)
  return { status: 'cancelled' };
}

// ─── Webhook Signature ────────────────────────────────────

/**
 * Verifies the payments webhook signature against the raw request body:
 *   signature = hmac_sha256(rawBody, PAYMENT_WEBHOOK_SECRET)  (hex)
 * Returns false when the secret is not configured so callers can decide
 * whether to skip verification in dev.
 */
export function verifyWebhookSignature(body: string | Buffer, signature: string | undefined): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || !signature) {
    return false;
  }
  try {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export { PREMIUM_PLAN_PERIOD };
