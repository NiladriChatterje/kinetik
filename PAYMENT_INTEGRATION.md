# Payment Integration — Google Pay Subscriptions (Autopay Mandate)

Kinetik Premium (₹250/month) is billed through the **Google Pay API**. Razorpay was removed because its React Native SDK is being discontinued.

| Layer | Where |
|---|---|
| Mobile checkout | `packages/mobile/src/screens/wallet/SubscriptionCheckoutScreen.tsx` using [`@google/react-native-make-payment`](https://github.com/google-pay/react-native-make-payment) (Google's official RN library, per the [React Native codelab](https://codelabs.developers.google.com/codelabs/pay-react-native)) |
| Server | `packages/api-core/src/services/googlePay.ts`, `routes/payments.ts`, `routes/webhooks.ts` |
| Config | `.env` at repo root (template: `.env.example`) → forwarded to api-core by docker-compose; plus one Android build flag in `packages/mobile/android/gradle.properties` |

## How the recurring flow works

1. **Create** — `POST /api/v1/payments/subscription` creates a pending subscription (id stored on the subscription ledger) and returns the Google Pay sheet configuration (merchant + gateway ids) plus the price in the user's local currency.
2. **Payment sheet** — the app builds a `PaymentRequest` (`supportedMethods: 'google_pay'`) and shows the native Google Pay sheet. The user approves the **recurring autopay mandate** — UPI Autopay in India, a tokenized card elsewhere — and the sheet returns a gateway payment token (`paymentMethodData.tokenizationData.token`).
3. **Activate** — `POST /api/v1/payments/subscription/activate` confirms the subscription belongs to the calling user, registers the token with the payment gateway as a recurring mandate (first charge included), then grants premium for one month.
4. **Renewals / cancellation** — the gateway executes the monthly mandate charges and posts `subscription.charged`, `subscription.activated`, `subscription.cancelled`, and `payment.captured` to `POST /api/v1/webhooks/payments` (HMAC-SHA256 over the raw body in the `x-payment-signature` header, payment-id dedupe). Cancellation revokes the mandate and stops auto-renew; the user keeps Premium until the paid cycle ends. Deleting the account revokes the mandate immediately.

The legacy one-off endpoints (`/payments/create-order`, `/payments/verify`) contain dev stubs and are not called anywhere by the app.

> **Important:** Google Pay only returns a *payment token* — it does not move money itself. The actual charging (mandate registration, monthly renewals) is executed by your **payment service provider (PSP)** using that token. `registerAutopayMandate` / `revokeAutopayMandate` in `services/googlePay.ts` are dev stubs today; wiring your PSP's recurring-payments API there is step 6 of the NEED list below.

## Configuration reference

| Variable (`.env`) | Meaning |
|---|---|
| `GOOGLE_PAY_ENVIRONMENT` | `TEST` (works immediately, fake cards) or `PRODUCTION`. Note: the mobile sheet's environment is separate — see `GOOGLE_PAY_ENVIRONMENT` in `packages/mobile/android/gradle.properties` (build-time). |
| `GOOGLE_PAY_MERCHANT_ID` | Your merchant id from the Google Pay & Wallet Console (`BCR2DN...`). Optional in TEST, **required** in PRODUCTION. |
| `GOOGLE_PAY_MERCHANT_NAME` | Name shown on the payment sheet. |
| `GOOGLE_PAY_GATEWAY` | Your PSP's Google Pay gateway identifier (e.g. `example` in TEST). |
| `GOOGLE_PAY_GATEWAY_MERCHANT_ID` | Your merchant id **at the PSP** (e.g. `exampleGatewayMerchantId` in TEST). |
| `GOOGLE_PAY_COUNTRY_CODE` | Merchant country for `transactionInfo` (default `IN`). |
| `PAYMENT_WEBHOOK_SECRET` | HMAC secret shared with the PSP for `POST /api/v1/webhooks/payments`; leave empty only in dev. |

Nothing secret lives on the mobile side — the app receives merchant/gateway ids from the server at checkout time.

## NEED: everything you must set up to accept real payments

Do these **in order**. Steps 1–3 are pure console/account work, 4–7 are config + one code wiring task, 8–10 are Google's approval gate.

### 1. Create your Google Pay & Wallet Console account (→ Merchant ID)

- Go to **https://pay.google.com/business/console** and sign in with the Google account that will own the merchant profile (use a company account, not a personal one — ownership transfers are painful).
- Complete the **Business profile**: legal business name, address, website, and business description. Accept the Google Pay API Terms of Service.
- Your **Merchant ID** (format `BCR2DN...`) appears in the top-right of the console / under Business profile. Copy it into `GOOGLE_PAY_MERCHANT_ID` in `.env`.

### 2. Sign up with a PSP that supports Google Pay + recurring in India

Google Pay hands you a token; a PSP charges it. Pick one from Google's **participating processors** list — https://developers.google.com/pay/api#participating-processors — that supports **INR, UPI Autopay / recurring mandates** (e.g. Cashfree, PayU, Paytm, Juspay — verify current recurring support with their sales/docs before signing).

From the PSP you need **four things**:
- Their **gateway identifier** for Google Pay tokenization → `GOOGLE_PAY_GATEWAY` (each PSP documents its exact string, e.g. `cashfree`, `payu`)
- Your **gateway merchant id** at the PSP → `GOOGLE_PAY_GATEWAY_MERCHANT_ID`
- Their **server API key/secret** (used by `services/googlePay.ts` to register/charge/cancel mandates — this never goes to the app)
- A **webhook signing secret** → `PAYMENT_WEBHOOK_SECRET`

This also requires completing the PSP's **merchant KYC** (business PAN, bank account, etc.) and asking them to **enable recurring payments / UPI Autopay** on your account — it is usually an opt-in product, not on by default.

### 3. Register the Android app in the console

- In the Google Pay & Wallet Console → **Google Pay API** → **Integrations**, add your Android app (package name `com.…` from `packages/mobile/app.json` / the Android manifest).
- Reference: https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration

### 4. Fill in `.env` (server) and restart api-core

```bash
GOOGLE_PAY_ENVIRONMENT=TEST            # keep TEST until step 10
GOOGLE_PAY_MERCHANT_ID=BCR2DN...       # from step 1
GOOGLE_PAY_MERCHANT_NAME=Kinetik
GOOGLE_PAY_GATEWAY=<psp-gateway-id>    # from step 2
GOOGLE_PAY_GATEWAY_MERCHANT_ID=<your-id-at-psp>
GOOGLE_PAY_COUNTRY_CODE=IN
PAYMENT_WEBHOOK_SECRET=<psp-webhook-secret>
```

### 5. Point the PSP's webhook at your server

In the PSP dashboard, register `https://<your-api-domain>/api/v1/webhooks/payments` for payment-captured / subscription-charged / subscription-cancelled events, signed with `PAYMENT_WEBHOOK_SECRET` (HMAC-SHA256 hex over the raw body, sent in the `x-payment-signature` header — adapt the header name in `routes/webhooks.ts` if your PSP can't customize theirs).

### 6. Wire the PSP's recurring API into the two stubs

In `packages/api-core/src/services/googlePay.ts`:
- `registerAutopayMandate()` → call the PSP's "create mandate / subscription with Google Pay token" API (first charge included).
- `revokeAutopayMandate()` → call the PSP's mandate-cancellation API.

This is the only code change left between you and real money movement.

### 7. Verify the mobile build requirements

- The app must be built as a **dev client / release APK** (`npx expo prebuild` already done — `android/` exists); the library is a native module, so Expo Go won't work.
- Min SDK 23+, and the device needs **Google Wallet** installed with a payment method. Setup reference: https://developers.google.com/pay/api/android/guides/setup

### 8. Test end-to-end in TEST mode

- With `GOOGLE_PAY_ENVIRONMENT=TEST` (both `.env` and `packages/mobile/android/gradle.properties`), the payment sheet serves Google's fake **test card suite** — join the test-cards group per https://developers.google.com/pay/api/android/guides/resources/test-card-suite
- Run the whole flow: subscribe → sheet → token → `/subscription/activate` → premium granted → cancel → auto-renew off.

### 9. Pass Google's integration checklist and request production access

- Work through https://developers.google.com/pay/api/android/guides/test-and-deploy/integration-checklist (branding rules, `isReadyToPay` gating, final price shown before charge).
- In the Google Pay & Wallet Console → your app integration → **upload screenshots of the working TEST integration** and **submit for approval**. Google's onboarding team reviews it; production access is granted per app.

### 10. Flip to production

- Set `GOOGLE_PAY_ENVIRONMENT=PRODUCTION` in **both** `.env` (server) and `packages/mobile/android/gradle.properties` (rebuild the release APK, signed with your release key).
- Ship via the Play Store (Google requires Play distribution for production Google Pay API apps).

> ⚠️ **Play Store policy caveat — read before step 9.** Google Play requires apps sold through the Play Store to use **Google Play Billing** for *digital* goods and subscriptions (which a dating-app premium tier is): the Google Pay API is intended for physical goods/services, and Google's own setup guide says digital-goods sellers should use Play In-app Billing. Approval in step 9 may be refused on these grounds. If it is, the fallback is Play Billing subscriptions (`react-native-iap` or Expo IAP) — the server webhook/ledger structure built here (activate → renew → cancel) maps 1:1 onto Play's Real-Time Developer Notifications, so the backend survives that swap mostly intact.

## Database

Migration `scripts/migrations/016_rename_razorpay_columns_to_gateway.sql` renames the `razorpay_*` columns on `subscription_ledger` and `transactions` to gateway-neutral `gateway_*` names. Run it against existing databases before deploying this version.

## Quick link index

| What | URL |
|---|---|
| Google Pay & Wallet Console (merchant id, approvals) | https://pay.google.com/business/console |
| Android setup guide (prereqs, SDK) | https://developers.google.com/pay/api/android/guides/setup |
| Publish / go-live steps | https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration |
| Integration checklist (pre-approval) | https://developers.google.com/pay/api/android/guides/test-and-deploy/integration-checklist |
| Test card suite | https://developers.google.com/pay/api/android/guides/resources/test-card-suite |
| Participating PSPs | https://developers.google.com/pay/api#participating-processors |
| React Native library + codelab | https://github.com/google-pay/react-native-make-payment · https://codelabs.developers.google.com/codelabs/pay-react-native |
