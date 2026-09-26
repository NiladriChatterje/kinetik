# Payment Integration — Google Play Billing Subscriptions

Kinetik Premium (₹149/month, a single plan) is sold as a **Google Play Billing subscription**.

Google is the **merchant of record**. It shows the purchase sheet, takes whatever payment method
the user has on their Google account — UPI Autopay, card, Play balance — holds the recurring
mandate, charges monthly, retries failures, handles grace periods and refunds, and pays out
minus its service fee. **There is no PSP, and nothing in this repo charges anyone.**

> Play policy requires digital goods and services consumed in the app to be sold through Play
> Billing. Premium unlocks in-app features, so this is the required route — not the Google Pay
> API, which is for physical goods and was removed in this migration.

| Layer | Where |
|---|---|
| Mobile checkout | `packages/mobile/src/screens/wallet/SubscriptionCheckoutScreen.tsx` using [`expo-iap`](https://hyochan.github.io/expo-iap/) |
| Play API client | `packages/api-core/src/services/playBilling.ts` |
| Entitlement writer | `packages/api-core/src/services/subscriptionEntitlement.ts` |
| Routes | `packages/api-core/src/routes/payments.ts`, `routes/webhooks.ts` |
| Config | `.env` at repo root (template: `.env.example`) → forwarded to api-core by docker-compose |

## How it works

1. **Purchase** — the app connects to Play (`initConnection`), reads the product and its base-plan
   offer token (`fetchProducts`), and opens the sheet (`requestPurchase`). Google takes the money.
2. **Verify** — the purchase arrives on `purchaseUpdatedListener` with a `purchaseToken`. The app
   posts it to `POST /api/v1/payments/subscription/verify`. The server calls
   [`purchases.subscriptionsv2.get`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get),
   mirrors the result onto `subscription_ledger`, and **acknowledges** the purchase.
3. **Finish** — only after the server confirms does the app call `finishTransaction`. Doing it
   earlier would tell Play the purchase was handled while the user has no Premium.
4. **Renewals and everything after** — Google pushes a
   [real-time developer notification](https://developer.android.com/google/play/billing/rtdn-reference)
   to `POST /api/v1/webhooks/play?secret=…` on every state change. The handler treats it purely as
   a signal, re-reads the authoritative state, and applies it. Renewal, cancellation, expiry,
   account hold, refund and recovery all converge on that one path.

Both entry points share `applyPlayEntitlement()`, so there is exactly one place that decides
whether a user is Premium.

### Entitlement rule

Entitled when `subscriptionState` is `ACTIVE`, `IN_GRACE_PERIOD` or `CANCELED` **and** `expiryTime`
is still in the future. `CANCELED` is included on purpose — the user turned off renewal but paid
through the end of the cycle. `ON_HOLD` and `PAUSED` are excluded: Google has suspended the
subscription and access should stop until it recovers.

## Configuration reference

| Variable (`.env`) | Meaning |
|---|---|
| `GOOGLE_PLAY_PACKAGE_NAME` | Android package name; must match the Play Console listing. Default `com.kinetik.app`. |
| `GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID` | Subscription product id from Play Console. Default `kinetik_premium_monthly`. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Service-account key as inline JSON. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` | …or a path to the key file. Preferred under Docker. |
| `GOOGLE_PLAY_RTDN_SECRET` | Shared secret on the Pub/Sub push URL. Without it the RTDN endpoint rejects everything. |

Until a service account is configured, `/subscription/verify` returns **503** and the paywall says
payments aren't set up. Nothing secret reaches the app.

## NEED: everything to set up in Play Console

### 1. Payments profile — do this first, it has the longest lead time

**Setup → Payments profile.** Legal entity, PAN, GST if applicable, bank account, tax forms.
No paid product can be created until this verifies. Days to weeks.

### 2. Create the app

Package name must be exactly `com.kinetik.app` (see `packages/mobile/app.json`). **It is immutable
after the first upload.** Then complete the blocking declarations — privacy policy URL, Data
safety, content rating, target audience, store listing — or no track will publish.

### 3. Upload a signed build

Upload an **AAB** to **internal testing** with **Play App Signing** enabled.

> ⚠️ Play Billing does not work in a locally-built debug APK. The app must be installed **from
> Play**, signed with the key Play knows. `assembleDebug` builds cannot test purchases at all.

### 4. Create the subscription

**Monetise → Products → Subscriptions → Create subscription.**

- Product ID — must equal `GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID`. Permanent; choose carefully.
- Add a **base plan**: auto-renewing, billing period `P1M`.
- Price ₹149 for India; set or auto-convert other regions.
- Set **grace period** and **account hold** — without them a single failed UPI charge cancels
  the subscription outright instead of retrying.
- **Activate the base plan.** Creating it is not enough; an inactive plan is invisible to the app
  and `fetchProducts` returns nothing.

### 5. Licence testing

**Setup → Licence testing** — add your Gmail accounts. Testers are not charged and renewals are
accelerated (a monthly plan renews in minutes), which is the only practical way to exercise
renewal, cancellation and expiry.

### 6. Service account for server verification

1. **Google Cloud Console:** enable the **Google Play Android Developer API**.
2. **Play Console → Setup → API access:** link that GCP project, create a service account, grant
   it *View financial data* and *Manage orders and subscriptions*.
3. Download the JSON key → `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (inline) or mount it and set
   `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE`.

Permission changes can take a few hours to propagate; a fresh service account often returns 401
for a while.

### 7. Real-time developer notifications

1. Create a Pub/Sub topic in the same GCP project.
2. Grant **Publisher** on it to `google-play-developer-notifications@system.gserviceaccount.com`.
3. **Play Console → Monetise → Monetisation setup:** paste the topic name, then **Send test
   notification** — the handler logs `Test notification received`.
4. Create a **push** subscription on that topic pointing at
   `https://<your-api-domain>/api/v1/webhooks/play?secret=<GOOGLE_PLAY_RTDN_SECRET>`.

Generate the secret with `openssl rand -hex 32`. The endpoint returns 401 without it.

### 8. Test end-to-end

Install from the internal-testing link with a licence-tester account, then:
subscribe → sheet → verify → Premium granted → renewal (accelerated) → cancel in Play →
`SUBSCRIPTION_CANCELED` arrives → Premium persists until expiry → expires → back to free.

## Gotchas that will cost you money or time

- **Acknowledge within 3 days.** Google auto-refunds and revokes anything unacknowledged. The
  server acknowledges immediately after granting, and the RTDN path retries if that failed.
- **UPI Autopay can return `SUBSCRIPTION_STATE_PENDING`.** The mandate is not confirmed when the
  sheet closes. `/subscription/verify` responds `pending: true` and grants nothing, but it does
  bind the purchase token to the account in `play_pending_purchases` (migration 023). That matters
  because the RTDN that follows carries only the token: without the binding the webhook could not
  tell whose purchase completed, and Premium would only arrive if the user reopened the checkout
  screen before Google's three-day auto-refund. The app sends pending purchases to the server too
  and leaves the transaction unfinished; when the bank confirms, the webhook finds the user through
  the pending row, grants Premium, acknowledges, and removes the row. A mandate the bank rejects
  is removed the same way without touching the ledger.
- **Cancellation is a server operation**, via
  [`subscriptionsv2.cancel`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel).
  `POST /subscription/cancel` uses `USER_REQUESTED_STOP_RENEWALS`, which stops the next renewal
  and stays restorable from Play. The user keeps Premium until the period they paid for ends —
  it is not a refund. The ledger is not written by the cancel call itself; the
  `SUBSCRIPTION_CANCELED` notification is what updates it.
- **Account deletion cancels the subscription first.** `POST /auth/delete-account` calls
  `subscriptionsv2.cancel` with `DEVELOPER_REQUESTED_STOP_PAYMENTS` (non-restorable — there will
  be no account to restore into) and **aborts the deletion with 502 if that call fails**, so
  nobody is ever billed for an account that no longer exists.
- **Price must come from the store.** `/payments/pricing` returns a fallback derived from the
  user's phone country; Play charges its own regionally-set price. The paywall shows
  `product.displayPrice` and falls back only before the store connection is ready.
- **Restore on reinstall.** The screen calls `getAvailablePurchases()` on mount and re-verifies
  anything it finds, so a reinstall doesn't cost the user a second subscription.
- **Amounts on renewals are blank.** `subscriptionsv2` does not report the amount charged, so
  RTDN-driven rows record no amount and the billing history renders `—`. Play Console holds the
  real financial reports.

## Database

`scripts/migrations/020_play_billing_purchase_tokens.sql`:

- Widens `gateway_subscription_id`, `gateway_payment_id`, `gateway_order_id` to `TEXT`. Play
  purchase tokens routinely exceed `VARCHAR(255)` and would fail on the first real purchase.
- Indexes `subscription_ledger.gateway_subscription_id` — RTDN carries only a purchase token, so
  that column is how a notification finds its user.
- Adds a unique partial index on `transactions.gateway_payment_id` so redelivered notifications
  can't double-record a charge. Deduplicates existing rows first.

Run it against any existing database before deploying.

## Quick link index

| What | URL |
|---|---|
| Play Console | https://play.google.com/console |
| Play Billing subscription lifecycle | https://developer.android.com/google/play/billing/lifecycle/subscriptions |
| RTDN reference | https://developer.android.com/google/play/billing/rtdn-reference |
| `purchases.subscriptionsv2.get` | https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get |
| `purchases.subscriptions.acknowledge` | https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge |
| `purchases.subscriptionsv2.cancel` | https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel |
| Fight fraud and abuse | https://developer.android.com/google/play/billing/security |
| expo-iap docs | https://hyochan.github.io/expo-iap/ |
| Expo in-app purchases guide | https://docs.expo.dev/guides/in-app-purchases/ |
