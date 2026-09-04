# Kinetik — Free Forever Hosting Guide

> **Last updated:** August 22, 2026
> **Goal:** run the entire app online, **100% free, forever** — no trials, no credit card, no surprise bills.
>
> Written for: no credit card, no always-on computer at home, free subdomains only.

---

## 1. The big picture

Each part of the app gets a free home. "Sleeps" means the free host pauses the service when nobody uses it — a free pinging service (UptimeRobot) visits it every 5 minutes so it never actually sleeps.

| What | Runs on | Free forever? | Sleeps? |
|---|---|---|---|
| Database (PostgreSQL) | **Neon** | ✅ | Naps after 5 min, wakes in ~0.3 s (our app pings it anyway) |
| Redis — cache + chat plumbing + internal events | **Aiven for Valkey** (one instance, both roles) | ✅ | Only if fully idle — normal traffic + pings keep it on |
| Photo / media storage | **Cloudflare R2** | ✅ | Never |
| api-core (the main server) | **Render** free web service | ✅ | After 15 min → ping keeps it awake |
| realtime (chat sockets) | **Koyeb** free account | ✅ | After 1 h → ping keeps it awake |
| pose-service (selfie check) | **Not deployed** — optional, see §8 | ✅ | — |
| Push notifications | Expo Push | ✅ | Never |
| Address lookup (geocoding) | Geoapify (3,000/day) | ✅ | Never |
| Uptime pings + error logs | UptimeRobot, Sentry, Better Stack | ✅ | Never |

**Accounts you'll create:** Neon, Aiven, Cloudflare, Render (1), Koyeb (1), UptimeRobot. All free, none ask for a card.

> The Python match-engine and the flash-window feature were both retired — matching happens through swipes/likes in api-core, so there's no separate matching service to host at all.

---

## 2. Code changes you must make first (~10 minutes, one time)

**No new SDKs or libraries need to be installed.** The app already speaks the right "languages": Neon is plain PostgreSQL, Aiven's Valkey is plain Redis protocol, R2 is storage the app's existing S3 client understands, and the Expo / Play Billing SDKs are already in the code. The only edits are tiny settings tweaks:

### 2a. Tell Redis connections to use encryption (TLS)

Aiven (and the Upstash fallback) only accept encrypted connections. Add **one line** — `tls: {},` — inside the `new Redis({...})` settings in these 4 files (5 spots):

1. `packages/api-core/src/services/redis.ts`
2. `packages/api-core/src/services/eventBus.ts` (inside `getPublisher()`)
3. `packages/api-core/src/index.ts` (the Redis passed to the rate limiter)
4. `packages/realtime/src/index.ts` — **two spots**: the `pubClient` and the `eventBusClient` (the `eventBusPub` and `subClient` are duplicates and inherit it)

That's everything. All other "changes" are just filling in web addresses and passwords (environment variables, §11).

---

## 3. Database → Neon

Free: 500 MB storage, no expiry, no card.

1. Sign up at [neon.tech](https://neon.tech) → **New project** → pick a region near your users.
2. Copy the connection string — **use the one with `-pooler` in the address** (it handles many connections better):
   ```
   postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require
   ```
   This exact string is your `DATABASE_URL` everywhere.
3. Create the tables (once). Either with Docker:
   ```bash
   DB_HOST=ep-XXXX-pooler.us-east-2.aws.neon.tech DB_PORT=5432 \
   DB_USER=kinetik_user DB_PASSWORD=PASSWORD DB_NAME=kinetik \
   docker compose up migration-runner
   ```
   or with psql:
   ```bash
   psql "$DATABASE_URL" -f scripts/init-db.sql
   for f in scripts/migrations/*.sql; do psql "$DATABASE_URL" -1 -f "$f"; done
   ```

---

## 4. Redis → Aiven for Valkey

Free: **1 GB RAM, single node, no card, no time limit — and no monthly command quota.**
That last part is why Aiven is the primary choice: quota-metered Redis (like Upstash's
500k commands/month) was the app's tightest free-tier ceiling — rate limiting, chat
pub/sub, and presence all burn commands constantly. Valkey is the Linux Foundation fork
of Redis with the identical protocol; the app's ioredis clients and the Socket.IO adapter
work unchanged.

The app uses two *logical* Redis roles (cache/chat + internal events). On Aiven, **point
both at the same instance** — the split exists for quota isolation, not correctness:
cache keys and event-bus channels have distinct names and never collide.

1. Sign up at [aiven.io](https://aiven.io) → **Create service → Valkey** → plan **Free** →
   pick the region closest to your Render region (this is a single-region server, so
   cross-region latency would tax every request).
2. From the service's **Overview → Connection information**, copy:
   - **Host** (`valkey-xxxx-yyyy.aivencloud.com`)
   - **Port** — ⚠️ Aiven assigns a custom port (e.g. `12691`), **not** `6379`
   - **Password** (the `default` user's password — password-only auth works)
3. Fill **both** variable sets with the same values (§11): `REDIS_*` **and** `REDIS_EVENTS_*`.

> ⚠️ Aiven powers off free services that go **fully idle**. Real app traffic plus the
> UptimeRobot-driven health checks (§12) count as activity, so this doesn't bite a live
> deployment — but if you pause the project for weeks, expect to power it back on from
> the dashboard (one click; cache/pub-sub data is disposable anyway).

### Fallback: Upstash

If Aiven ever drops the free plan: [Upstash](https://upstash.com) — 256 MB and ~500k
commands/month **per database**, up to 10 databases, no card. Create **two** databases
(`kinetik-cache` → `REDIS_*`, `kinetik-events` → `REDIS_EVENTS_*`) to spread the quota,
copy host / port `6379` / password token from each dashboard's **Connect** tab, and
**claim both databases** — unclaimed ones are deleted after 3 days. Know the ceiling:
the command quota supports roughly 50–100 daily active users before running dry mid-month.

---

## 5. Photo storage → Cloudflare R2

Free: 10 GB storage, downloads cost nothing ever, no card.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → **Create bucket** named `kinetik-photos`.
2. **Manage R2 API Tokens → Create API token** (Read & Write on that bucket) → copy the Access Key ID + Secret.
3. Bucket **Settings → Public access → Create public bucket** — the `pub-xxxx.r2.dev` address is where photos are served from.
4. Add a CORS rule allowing `GET` from `*`.

Environment variables (⚠️ note: `MINIO_ENDPOINT` is **just the host, no `https://` in front** — the app adds that itself):

```
MINIO_ENDPOINT=<account-id>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret>
MINIO_BUCKET=kinetik-photos
MINIO_USE_SSL=true
MINIO_PUBLIC_URL=https://pub-<hash>.r2.dev/
```

---

## 6. Main server (api-core) → Render

Free: 512 MB RAM, 750 hours/month — exactly enough to keep **one** service awake all month.

> ⚠️ **One service per Render account.** A second one would eat the shared hours and take both down mid-month. Extra services go on Koyeb.

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo → root directory `/`.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install && npm run build -w packages/shared && npm run build -w packages/api-core`
   - Start command: `node packages/api-core/dist/index.js`
   - Instance type: **Free** · Health check path: `/health`
4. Add the api-core variables from §11 (don't set `PORT` — Render sets it).
5. Deploy → your address is `https://<name>.onrender.com`.

---

## 7. Chat server (realtime) → Koyeb

Free: 512 MB RAM, one web service, no card. One account is enough.

- Build: `npm install && npm run build -w packages/shared && npm run build -w packages/realtime`
- Run: `node packages/realtime/dist/index.js` · Port: `3002`
- Variables: §11. **`JWT_SECRET` must be exactly the same as api-core's** — otherwise every chat connection is rejected.

---

## 8. pose-service (KYC document face match) — skip it, on purpose

Selfie verification now runs **entirely on the phone** (ML Kit + MobileFaceNet — see
FACE_VERIFICATION_ONDEVICE.md), so this service is only needed for the opt-in KYC
document face check. It needs ~1 GB of memory; every no-card free tier tops out at 512 MB.
The app is built to work without it: onboarding never blocks on it.

- **Now:** leave `POSE_SERVICE_URL` empty (not `localhost` — empty, so the app fails fast and moves on). Only the KYC document check is affected.
- **Later:** self-host the service on a future $5 server and just set `POSE_SERVICE_URL` — no other code changes.

---

## 9. Third-party freebies

| Need | Service | Free tier | Variables |
|---|---|---|---|
| Push notifications | Expo Push | free | `EXPO_ACCESS_TOKEN` (optional) |
| Address lookup | Geoapify | 3,000/day | `GEOAPIFY_API` |
| SMS login codes | deferred | — | `SMS_DISABLED=true` |
| Payments | Google Play Billing | No hosting cost; Google takes a service fee per sale | `GOOGLE_PLAY_SERVICE_ACCOUNT_*`, `GOOGLE_PLAY_RTDN_SECRET` (+ see `PAYMENT_INTEGRATION.md`) |
| Error alerts | Sentry | 5k errors/month | — |
| Log storage | Better Stack | 100k logs/month | — |

**SMS note:** the login code is currently hardcoded to `123456` for everyone (`generateOtp()` in `routes/auth.ts`). Keep `SMS_DISABLED=true` until launch; real SMS always costs per message (~₹0.2–0.7), on any provider.

**Payments note:** Play Billing costs nothing to host — Google is the merchant of record and there is no PSP. Licence testers can buy without being charged. Going live needs a verified Play payments profile and an app published to a track; Google's service fee comes out of each sale — a payment fee, not a hosting fee.

---

## 10. The mobile app

Point it at your new addresses — `packages/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "apiUrl": "https://<api-core>.onrender.com",
  "wsUrl":  "https://<realtime>.koyeb.app"
}
```

Build & share (free):
- **Build:** Expo EAS free tier (30 builds/month): `eas build -p android --profile preview`
- **Android:** attach the APK to a **GitHub Release** — free permanent download link. (Google Play is a one-time $25 when you're ready.)
- **iOS:** needs the $99/year Apple Developer account — the one unavoidable cost. Skip until it's worth it.

---

## 11. All environment variables in one place

### api-core (Render)
```
NODE_ENV=production
DATABASE_URL=postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.../kinetik?sslmode=require
JWT_SECRET=<long-random-string>          # ⚠️ must match realtime exactly
JWT_EXPIRES_IN=7d
MESSAGE_ENCRYPTION_KEY=<random-32+-chars>
REDIS_HOST=valkey-xxxx-yyyy.aivencloud.com   # Aiven Valkey (both roles, same instance)
REDIS_PORT=<aiven-port>                      # custom port from the Aiven console, NOT 6379
REDIS_PASSWORD=<aiven-password>
REDIS_EVENTS_HOST=<same as REDIS_HOST>
REDIS_EVENTS_PORT=<same as REDIS_PORT>
REDIS_EVENTS_PASSWORD=<same as REDIS_PASSWORD>
MINIO_ENDPOINT=<account-id>.r2.cloudflarestorage.com   # no https:// prefix
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret>
MINIO_BUCKET=kinetik-photos
MINIO_USE_SSL=true
MINIO_PUBLIC_URL=https://pub-<hash>.r2.dev/
GEOAPIFY_API=<geoapify-key>
GOOGLE_PLAY_PACKAGE_NAME=com.kinetik.app
GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID=kinetik_premium_monthly
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=        # Play Console → Setup → API access
GOOGLE_PLAY_RTDN_SECRET=                 # secret on the Pub/Sub push URL
SMS_DISABLED=true
EXPO_ACCESS_TOKEN=                       # optional
POSE_SERVICE_URL=                        # leave empty
```

### realtime (Koyeb)
```
JWT_SECRET=<same as api-core>
DATABASE_URL=<same as api-core>
REDIS_HOST / REDIS_PORT / REDIS_PASSWORD            = same as api-core
REDIS_EVENTS_HOST / REDIS_EVENTS_PORT / REDIS_EVENTS_PASSWORD = same as api-core
```

---

## 12. Keep everything awake — UptimeRobot

Free: 50 monitors, checks every 5 minutes. These pings double as health checks:

| Monitor | URL |
|---|---|
| api-core | `https://<api-core>.onrender.com/health` |
| realtime | `https://<realtime>.koyeb.app/socket.io/?EIO=4&transport=polling` |

---

## 13. Deployment checklist

- [ ] Code tweaks (§2): 5 Node TLS lines
- [ ] Neon: project → **pooled** `DATABASE_URL` → run migrations
- [ ] Aiven: free Valkey service → copy host + custom port + password (fills both `REDIS_*` and `REDIS_EVENTS_*`)
- [ ] Cloudflare R2: bucket → API token → public access → CORS
- [ ] Render: deploy api-core → env vars → note the URL
- [ ] Koyeb: deploy realtime → env vars → note the URL
- [ ] UptimeRobot: 2 monitors (§12) — this is what keeps everything awake
- [ ] Mobile: `apiUrl`/`wsUrl` in `app.json` → `eas build` → APK to GitHub Releases
- [ ] Test the loop: signup (code `123456`) → onboarding → photo upload → like → match → chat

---

## 14. Growing out of free (nothing is a dead end)

The repo's `docker-compose.yml` runs the entire stack unchanged, so upgrading is just moving:

| When | Move to | Cost |
|---|---|---|
| Want zero sleep, still no card | Old PC / Raspberry Pi at home + free Cloudflare Tunnel | $0 |
| Get a card (just for signup) | Oracle Cloud "Always Free" ARM server — runs everything | $0 |
| Ready to pay a little | Hetzner / DigitalOcean $5–6 server + `docker compose up` | ~$5–6/mo |

---

## 15. What genuinely can't be free

| Item | Why | Today's workaround |
|---|---|---|
| iOS app | Apple charges $99/year | Android APK via GitHub Releases |
| Custom domain | ~$10/year | free `.onrender.com` / `.koyeb.app` addresses |
| Real SMS | per-message fees | login code stays `123456` in dev |
| Live payments | ~2% per transaction | test keys free forever |
| Selfie verification hosting | needs 1 GB RAM | optional by design (§8) |

---

## 16. Gotchas (learned the hard way)

1. **Render = one awake service per account.** Two services will suspend each other mid-month.
2. **Always use Neon's `-pooler` address** — the app opens up to 20 connections; the plain address can't handle it.
3. **Hosted Redis needs the TLS tweak (§2a)** — Aiven and Upstash both refuse plain connections; without it, Redis silently retries forever and nothing works. And Aiven's port is a **custom one from the console, not 6379** — the #1 copy-paste mistake.
4. **`JWT_SECRET` must be byte-identical** on api-core and realtime.
5. **The login code is hardcoded `123456`** — change it before you pay for SMS.
6. **`MINIO_ENDPOINT` must NOT include `https://`** — the code prepends the scheme itself; doubling it breaks uploads.
7. **A sleeping realtime service misses live events** (chat broadcasts and match pop-ups are fire-and-forget) — the UptimeRobot ping is what prevents this.
8. **Back up Neon weekly** — free tiers have no backups. A free GitHub Actions cron running `pg_dump` → upload to R2 covers it.
