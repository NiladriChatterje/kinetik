# Kinetik — Free Forever Hosting Guide

> **Last updated:** August 16, 2026
> **Goal:** run the entire app online, **100% free, forever** — no trials, no credit card, no surprise bills.
>
> Written for: no credit card, no always-on computer at home, free subdomains only.

---

## 1. The big picture

Each part of the app gets a free home. "Sleeps" means the free host pauses the service when nobody uses it — a free pinging service (UptimeRobot) visits it every 5 minutes so it never actually sleeps.

| What | Runs on | Free forever? | Sleeps? |
|---|---|---|---|
| Database (PostgreSQL) | **Neon** | ✅ | Naps after 5 min, wakes in ~0.3 s (our app pings it anyway) |
| Redis — cache + chat plumbing | **Upstash** database #1 | ✅ | Never |
| Redis — internal event messages | **Upstash** database #2 | ✅ | Never |
| Photo / media storage | **Cloudflare R2** | ✅ | Never |
| Voice & video calls | **LiveKit Cloud** (Build plan) | ✅ | Never |
| api-core (the main server) | **Render** free web service | ✅ | After 15 min → ping keeps it awake |
| realtime (chat sockets + flash-window matching) | **Koyeb** free account | ✅ | After 1 h → ping keeps it awake |
| pose-service (selfie check) | **Not deployed** — optional, see §9 | ✅ | — |
| Push notifications | Expo Push | ✅ | Never |
| Address lookup (geocoding) | Geoapify (3,000/day) | ✅ | Never |
| Uptime pings + error logs | UptimeRobot, Sentry, Better Stack | ✅ | Never |

**Accounts you'll create:** Neon, Upstash, Cloudflare, LiveKit, Render (1), Koyeb (1), UptimeRobot. All free, none ask for a card.

> The Python match-engine was retired — flash-window matching now runs inside the realtime service, so there's no separate matching service to host at all.

---

## 2. Code changes you must make first (~10 minutes, one time)

**No new SDKs or libraries need to be installed.** The app already speaks the right "languages": Neon is plain PostgreSQL, Upstash is plain Redis, R2 is storage the app's existing S3 client understands, and the LiveKit / Expo / Razorpay SDKs are already in the code. The only edits are tiny settings tweaks:

### 2a. Tell Redis connections to use encryption (TLS)

Upstash only accepts encrypted connections. Add **one line** — `tls: {},` — inside the `new Redis({...})` settings in these 4 files (5 spots):

1. `packages/api-core/src/services/redis.ts`
2. `packages/api-core/src/services/eventBus.ts` (inside `getPublisher()`)
3. `packages/api-core/src/index.ts` (the Redis passed to the rate limiter)
4. `packages/realtime/src/index.ts` — **two spots**: the `pubClient` and the `eventBusClient` (the `eventBusPub` and `subClient` are duplicates and inherit it)

That's everything. All other "changes" are just filling in web addresses and passwords (environment variables, §12).

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

## 4. Redis ×2 → Upstash

Free: 256 MB and ~500k commands/month **per database**, up to 10 databases, no card.

Create **two** databases (the app deliberately uses two — one for caching/chat, one for internal events):

1. `kinetik-cache` → fills the `REDIS_*` variables
2. `kinetik-events` → fills the `REDIS_EVENTS_*` variables

For each: dashboard → **Connect** → copy host, port `6379`, and the password token.

> ⚠️ **Claim both databases** into your account — unclaimed ones are deleted after 3 days.

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

## 6. Calls → LiveKit Cloud

Free "Build" plan: 50 GB traffic + 5,000 call minutes per month, no card.

1. Sign up at [livekit.io](https://livekit.io) → create a project.
2. **Settings → Keys** → copy the host, API key, and API secret:
   ```
   LIVEKIT_HOST=wss://<project>.livekit.cloud
   LIVEKIT_API_KEY=APIxxx
   LIVEKIT_API_SECRET=<secret>
   LIVEKIT_PUBLIC_URL=wss://<project>.livekit.cloud
   ```

> Don't try to self-host LiveKit on a free tier — calls need network features only a real server has. The free cloud plan is the right answer.

> **Testing calls on your own Wi-Fi with Docker?** Set `LIVEKIT_RTC_NODE_IP=<your PC's LAN IP>` in `.env`, or calls will connect but stay silent/black.

---

## 7. Main server (api-core) → Render

Free: 512 MB RAM, 750 hours/month — exactly enough to keep **one** service awake all month.

> ⚠️ **One service per Render account.** A second one would eat the shared hours and take both down mid-month. Extra services go on Koyeb.

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo → root directory `/`.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install && npm run build -w packages/shared && npm run build -w packages/api-core`
   - Start command: `node packages/api-core/dist/index.js`
   - Instance type: **Free** · Health check path: `/health`
4. Add the api-core variables from §12 (don't set `PORT` — Render sets it).
5. Deploy → your address is `https://<name>.onrender.com`.

---

## 8. Chat server (realtime, includes matching) → Koyeb

Free: 512 MB RAM, one web service, no card. One account is enough — flash-window matching runs inside this service.

- Build: `npm install && npm run build -w packages/shared && npm run build -w packages/realtime`
- Run: `node packages/realtime/dist/index.js` · Port: `3002`
- Variables: §12. **`JWT_SECRET` must be exactly the same as api-core's** — otherwise every chat connection is rejected.

---

## 9. pose-service (selfie verification) — skip it, on purpose

It needs ~1 GB of memory; every no-card free tier tops out at 512 MB. The app is built to work without it: onboarding never blocks on it, users simply stay "pending" instead of "verified". Only the opt-in KYC face check truly needs it.

- **Now:** leave `POSE_SERVICE_URL` empty (not `localhost` — empty, so the app fails fast and moves on).
- **Later:** either run the check on the phone itself (MediaPipe works on-device, free forever) or self-host the service on a future $5 server and just set `POSE_SERVICE_URL` — no other code changes.

---

## 10. Third-party freebies

| Need | Service | Free tier | Variables |
|---|---|---|---|
| Push notifications | Expo Push | free | `EXPO_ACCESS_TOKEN` (optional) |
| Address lookup | Geoapify | 3,000/day | `GEOAPIFY_API` |
| SMS login codes | deferred | — | `SMS_DISABLED=true` |
| Payments | Razorpay | test keys free forever | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (+ see `PAYMENT_INTEGRATION.md`) |
| Error alerts | Sentry | 5k errors/month | — |
| Log storage | Better Stack | 100k logs/month | — |

**SMS note:** the login code is currently hardcoded to `123456` for everyone (`generateOtp()` in `routes/auth.ts`). Keep `SMS_DISABLED=true` until launch; real SMS always costs per message (~₹0.2–0.7), on any provider.

**Payments note:** Razorpay test keys are free forever. Going live needs business KYC and costs ~2% per transaction — a payment fee, not a hosting fee.

---

## 11. The mobile app

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

## 12. All environment variables in one place

### api-core (Render)
```
NODE_ENV=production
DATABASE_URL=postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.../kinetik?sslmode=require
JWT_SECRET=<long-random-string>          # ⚠️ must match realtime exactly
JWT_EXPIRES_IN=7d
MESSAGE_ENCRYPTION_KEY=<random-32+-chars>
REDIS_HOST=<cache>.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=<token>
REDIS_EVENTS_HOST=<events>.upstash.io
REDIS_EVENTS_PORT=6379
REDIS_EVENTS_PASSWORD=<token>
LIVEKIT_HOST=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=APIxxx
LIVEKIT_API_SECRET=<secret>
LIVEKIT_PUBLIC_URL=wss://<project>.livekit.cloud
MINIO_ENDPOINT=<account-id>.r2.cloudflarestorage.com   # no https:// prefix
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret>
MINIO_BUCKET=kinetik-photos
MINIO_USE_SSL=true
MINIO_PUBLIC_URL=https://pub-<hash>.r2.dev/
GEOAPIFY_API=<geoapify-key>
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=<razorpay-test-secret>
RAZORPAY_WEBHOOK_SECRET=                 # set when you add the webhook (PAYMENT_INTEGRATION.md)
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

## 13. Keep everything awake — UptimeRobot

Free: 50 monitors, checks every 5 minutes. These pings double as health checks:

| Monitor | URL |
|---|---|
| api-core | `https://<api-core>.onrender.com/health` |
| realtime | `https://<realtime>.koyeb.app/socket.io/?EIO=4&transport=polling` |

---

## 14. Deployment checklist

- [ ] Code tweaks (§2): 5 Node TLS lines
- [ ] Neon: project → **pooled** `DATABASE_URL` → run migrations
- [ ] Upstash: `kinetik-cache` + `kinetik-events` → **claim both** → copy hosts/tokens
- [ ] Cloudflare R2: bucket → API token → public access → CORS
- [ ] LiveKit Cloud: project → host + key + secret
- [ ] Render: deploy api-core → env vars → note the URL
- [ ] Koyeb: deploy realtime → env vars → note the URL
- [ ] UptimeRobot: 2 monitors (§13) — this is what keeps everything awake
- [ ] Mobile: `apiUrl`/`wsUrl` in `app.json` → `eas build` → APK to GitHub Releases
- [ ] Test the loop: signup (code `123456`) → onboarding → photo upload → like → match → chat → call

---

## 15. Growing out of free (nothing is a dead end)

The repo's `docker-compose.yml` runs the entire stack unchanged, so upgrading is just moving:

| When | Move to | Cost |
|---|---|---|
| Want zero sleep, still no card | Old PC / Raspberry Pi at home + free Cloudflare Tunnel | $0 |
| Get a card (just for signup) | Oracle Cloud "Always Free" ARM server — runs everything | $0 |
| Ready to pay a little | Hetzner / DigitalOcean $5–6 server + `docker compose up` | ~$5–6/mo |

---

## 16. What genuinely can't be free

| Item | Why | Today's workaround |
|---|---|---|
| iOS app | Apple charges $99/year | Android APK via GitHub Releases |
| Custom domain | ~$10/year | free `.onrender.com` / `.koyeb.app` addresses |
| Real SMS | per-message fees | login code stays `123456` in dev |
| Live payments | ~2% per transaction | test keys free forever |
| Selfie verification hosting | needs 1 GB RAM | optional by design (§9) |

---

## 17. Gotchas (learned the hard way)

1. **Render = one awake service per account.** Two services will suspend each other mid-month.
2. **Always use Neon's `-pooler` address** — the app opens up to 20 connections; the plain address can't handle it.
3. **Upstash needs the TLS tweak (§2a)** — without it, Redis silently retries forever and nothing works.
4. **`JWT_SECRET` must be byte-identical** on api-core and realtime.
5. **The login code is hardcoded `123456`** — change it before you pay for SMS.
6. **`MINIO_ENDPOINT` must NOT include `https://`** — the code prepends the scheme itself; doubling it breaks uploads.
7. **A sleeping realtime service misses window-join events** (they're fire-and-forget), which delays flash-window matching — the UptimeRobot ping is what prevents this.
8. **Back up Neon weekly** — free tiers have no backups. A free GitHub Actions cron running `pg_dump` → upload to R2 covers it.
