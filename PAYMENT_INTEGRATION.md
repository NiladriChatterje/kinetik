# Payment Integration — Google Pay Subscriptions (Autopay Mandate)

Razorpay has been removed (the Razorpay React Native SDK is being discontinued). Premium is now billed through the **Google Pay API**: server (`packages/api-core/src/routes/payments.ts`, `services/googlePay.ts`, `routes/webhooks.ts`), mobile checkout (`packages/mobile/src/screens/wallet/SubscriptionCheckoutScreen.tsx` with [`@google/react-native-make-payment`](https://codelabs.developers.google.com/codelabs/pay-react-native)), and config plumbing.

## How the recurring flow works

1. **Create** — `POST /api/v1/payments/subscription` creates a pending subscription (id stored on the subscription ledger) and returns the Google Pay sheet configuration (merchant + gateway ids, environment) plus the price in the user's local currency.
2. **Payment sheet** — the app builds a `PaymentRequest` (`supportedMethods: 'google_pay'`) and shows the native Google Pay sheet. The user approves the **recurring autopay mandate** — UPI Autopay in India, a tokenized card elsewhere — and the sheet returns a gateway payment token (`paymentMethodData.tokenizationData.token`).
3. **Activate** — `POST /api/v1/payments/subscription/activate` confirms the subscription belongs to the calling user, registers the token with the payment gateway as a recurring mandate (first charge included), then grants premium for one month.
4. **Renewals / cancellation** — the gateway executes the monthly mandate charges and posts `subscription.charged`, `subscription.activated`, `subscription.cancelled`, and `payment.captured` to `POST /api/v1/webhooks/payments` (HMAC-SHA256 over the raw body in the `x-payment-signature` header, payment-id dedupe). Cancellation revokes the mandate and stops auto-renew; the user keeps Premium until the paid cycle ends. Deleting the account revokes the mandate immediately.

The legacy one-off endpoints (`/payments/create-order`, `/payments/verify`) contain dev stubs but are not called anywhere by the app — the subscription flow does not touch them.

> `registerAutopayMandate` / `revokeAutopayMandate` in `services/googlePay.ts` are where the PSP's recurring-payments API gets called in production — they are dev stubs today (matching the pre-existing dev-stub style of the one-off endpoints).

## Required configuration

All values go in **`.env` at the repo root** (template in `.env.example`); docker-compose forwards them to the api-core container. Restart api-core after changing them.

| Variable | Where to get it |
|---|---|
| `GOOGLE_PAY_ENVIRONMENT` | `TEST` (works immediately, test cards) or `PRODUCTION` |
| `GOOGLE_PAY_MERCHANT_ID` | [Google Pay & Wallet Console](https://pay.google.com/business/console) → your merchant id (`BCR2DN...`); required for `PRODUCTION` |
| `GOOGLE_PAY_MERCHANT_NAME` | Name shown on the payment sheet |
| `GOOGLE_PAY_GATEWAY` / `GOOGLE_PAY_GATEWAY_MERCHANT_ID` | Your PSP's Google Pay tokenization identifiers (`example` / `exampleGatewayMerchantId` in TEST mode) |
| `GOOGLE_PAY_COUNTRY_CODE` | Merchant country for `transactionInfo` (default `IN`) |
| `PAYMENT_WEBHOOK_SECRET` | HMAC secret shared with the PSP for `POST /api/v1/webhooks/payments`; leave empty only in dev |

Nothing secret is configured on the mobile side — the app receives merchant/gateway ids from the server at checkout time.

## Prerequisites (no code)

- **Android only** — the Google Pay API payment sheet is Android-only; `canMakePayment()` returns false elsewhere and the app surfaces "Google Pay is not available on this device".
- `@google/react-native-make-payment` is a native module — Expo users need a dev client / prebuild (`npx expo prebuild`), not Expo Go.
- For `PRODUCTION`: register the app in the Google Pay & Wallet Console and get the integration approved; enable recurring payments/UPI Autopay with your PSP.

## Database

Migration `scripts/migrations/016_rename_razorpay_columns_to_gateway.sql` renames the `razorpay_*` columns on `subscription_ledger` and `transactions` to gateway-neutral `gateway_*` names. Run it against existing databases before deploying this version.
