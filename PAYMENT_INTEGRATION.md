# Payment Integration — Razorpay Subscriptions

Status: **complete**. Audited end to end on 2026-08-16 — server (`packages/api-core/src/routes/payments.ts`, `services/razorpay.ts`, `routes/webhooks.ts`), mobile checkout (`packages/mobile/src/screens/wallet/SubscriptionCheckoutScreen.tsx` with `react-native-razorpay`), and config plumbing.

## How the recurring flow works

1. **Create** — `POST /api/v1/payments/subscription` creates/reuses the ₹100/month Razorpay Plan and a 12-cycle Subscription (`notes.user_id` set for webhook correlation), and records it on the subscription ledger.
2. **Checkout** — the app opens native Razorpay Checkout with `subscription_id`. No `method` restriction is passed, so Checkout offers **every recurring method enabled on the Razorpay account**: credit card, debit card, UPI Autopay (mandate), and eMandate/net-banking.
3. **Verify** — `POST /api/v1/payments/subscription/verify` checks the HMAC (`payment_id|subscription_id`, timing-safe), confirms the subscription belongs to the calling user, then fetches the authoritative status from Razorpay. Both `active` (card charged) **and** `authenticated` (UPI/eMandate mandate approved, first charge follows on schedule) grant premium.
4. **Renewals / cancellation** — `POST /api/v1/webhooks/razorpay` handles `subscription.charged`, `subscription.activated`, `subscription.cancelled`, and `payment.captured`, with signature verification and payment-id dedupe. Cancellation is at-cycle-end; the webhook flips the tier back to free when the paid cycle ends.

The legacy one-off endpoints (`/payments/create-order`, `/payments/verify`) contain dev stubs but are not called anywhere by the app — the subscription flow does not touch them.

## Required configuration

All values go in **`.env` at the repo root** (template in `.env.example`); docker-compose forwards them to the api-core container. Restart api-core after changing them.

| Variable | Where to get it |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Account & Settings → **API Keys** (`rzp_test_...` / `rzp_live_...`) |
| `RAZORPAY_KEY_SECRET` | Shown once when generating the API key pair — same screen |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard → Account & Settings → **Webhooks** → create a webhook pointing to `https://<your-api-domain>/api/v1/webhooks/razorpay`, subscribed to `payment.captured`, `subscription.charged`, `subscription.activated`, `subscription.cancelled`; the secret string you type there goes here |
| `RAZORPAY_PLAN_ID` (optional, recommended in prod) | Dashboard → Subscriptions → **Plans** → create the ₹100/monthly plan once and paste its `plan_...` id; otherwise the server auto-creates a plan on first use |

Nothing is configured on the mobile side — the app receives the key id from the server at checkout time.

## Dashboard-only prerequisites (no code)

- **Enable recurring payment methods** for the business: UPI Autopay, eMandate, and cards recurring each need activation/approval under Settings → Payment Methods. Test mode has them all; live mode requires Razorpay's approval for Subscriptions.
- **Complete KYC** to obtain live keys.
