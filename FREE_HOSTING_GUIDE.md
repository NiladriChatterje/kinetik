# Kinetik — Free Forever Hosting Guide (v2)

> **Last updated:** August 12, 2026
> **Goal:** Every platform in the Kinetik stack deployed and **running**, 100% free, **forever** — no 7-day trials, no 30-day expirations, no expiring credits, no credit card, no surprise bills. You only pay later if *you* decide to upgrade.
>
> **This version is written for your situation:** no credit card available, no always-on machine at home, free subdomains only. It uses only free tiers that stay free forever and requires **no card anywhere**.

---

## What changed vs. the old guide (v1)

The old guide was written when some things were still possible. In 2026 they are not — and the new guide fixes all of them:

| Old advice | 2026 reality |
|---|---|
| Hugging Face Spaces for the Python pose-service (Docker, no sleep) | ❌ **Hugging Face now charges for Docker/Gradio Spaces** — free accounts can no longer deploy them. Gone. |
| Render free PostgreSQL as a backup option | ❌ **Render free Postgres expires after 30 days and is then permanently deleted** (14-day grace, then wiped). Never use it. |
| AWS t2.micro / GCP trial as fallbacks | ❌ 12-month / 90-day trials — excluded by your rules anyway. |
| "Render can host both Node services" | ⚠️ Render free = **750 instance-hours/month per workspace** ≈ enough to keep exactly **one** service awake 24/7. |
| Koyeb as a sleep-free host | ⚠️ Koyeb free now sleeps after **1 hour** idle — fixable with keep-alive pings. |
| LiveKit self-hosted on a VM | ✅ LiveKit Cloud **Build plan** is free forever (no card): 50 GB/month + 5,000 WebRTC minutes. Use it. |

**The honest bottom line for no-card, no-machine, cloud-only:**
- ✅ **api-core**, **realtime**, **match-engine** — can all run free forever (details below).
- ✅ **Postgres, Redis ×2, object storage, LiveKit, push, monitoring** — all free forever managed services.
- ⚠️ **pose-service** (Python + OpenCV + MediaPipe, needs ~1 GB RAM) — has **no** free-forever cloud home on a no-card tier. **Good news: it's optional** — the API already degrades gracefully when it's down, so the app runs fine without it (§10).
- ⚠️ The **Celery worker** has no free home either — a **one-line tweak** folds its job back into the match-engine process (§9), so nothing is lost.

---

## 1. The Plan at a Glance

| Component | Where it runs | Free forever? | Card? | Sleeps? |
|---|---|---|---|---|
| PostgreSQL | **Neon** (free plan) | ✅ | ❌ | Scales to zero (~350 ms resume) |
| Redis (cache + Socket.IO adapter) | **Upstash** DB #1 | ✅ | ❌ | Serverless — no sleep |
| Redis (event bus) | **Upstash** DB #2 | ✅ | ❌ | Serverless — no sleep |
| Object storage (photos/KYC/chat media) | **Cloudflare R2** | ✅ | ❌ | Never |
| WebRTC SFU (calls) | **LiveKit Cloud** Build plan | ✅ | ❌ | Never |
| api-core (Fastify REST API) | **Render** free web service | ✅ | ❌ | Sleeps after 15 min → keep-alive pings |
| realtime (Socket.IO) | **Koyeb** free web service | ✅ | ❌ | Sleeps after 1 h → keep-alive pings |
| match-engine (Python/H3) | **Koyeb** (2nd free account) | ✅ | ❌ | Sleeps → keep-alive pings |
| match-engine Celery worker | Folded into match-engine (1-line tweak) | ✅ | ❌ | n/a |
| pose-service | **Not deployed** — optional (§10) | ✅ | ❌ | n/a |
| Push notifications | Expo Push (free) | ✅ | ❌ | Never |
| Geocoding | Geoapify (3,000 credits/day) | ✅ | ❌ | Never |
| Uptime/monitoring | UptimeRobot + Sentry + Better Stack | ✅ | ❌ | Never |

**You will need 3 free accounts total:** Render (1), Koyeb (2 — one per service, see §8–9).

---

## 2. Step 0 — One-time code tweaks (≈10 minutes, do this first)

The stack was written for self-hosted infra (plaintext Redis, Celery, MinIO). Three tiny tweaks make it work on managed free tiers. Everything below is already in this repo — the file paths are exact.

### 2a. Managed Redis requires TLS (Upstash/Aiven)

Upstash's `redis://` endpoint is TLS-only, and ioredis won't negotiate TLS unless you ask it to. Add **one line** to each ioredis constructor:

**`packages/api-core/src/services/redis.ts`** (rate-limit + cache client):
```ts
redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  tls: {},                       // ← ADD THIS (Upstash/Aiven)
  retryStrategy: (times) => { ... },
  ...
});
```

**`packages/api-core/src/services/eventBus.ts`** — same one line inside the `new Redis({...})` in `getPublisher()`.

**`packages/api-core/src/index.ts`** — same one line inside the `new Redis({...})` passed to the rate-limit plugin.

**`packages/realtime/src/index.ts`** — same one line in the `pubClient` constructor (`subClient = pubClient.duplicate()` inherits it) **and** in the `eventBusClient` constructor.

Python side (only if you run the match-engine against Upstash):
- **`packages/match-engine-py/src/services/redis_client.py`** — `connect()` uses `aioredis.from_url(f"redis://{host}:{port}", ...)`. Change the scheme to `rediss://` (redis-py 8.x supports it) so TLS is on.
- **`packages/match-engine-py/src/services/event_bus.py`** — `AsyncRedis(host=..., port=..., password=...)`: add `ssl=True`.

> Skip 2a if you'd rather use **Aiven Redis** (free 250 MB, always-on managed instance) — Aiven is also TLS-only, so the same tweak applies.

### 2b. (Recommended) Run match jobs in-process — drop the Celery worker

**`packages/match-engine-py/src/main.py`**, inside the event-bus handler:

```python
# BEFORE:
find_match.apply_async(args=[uid, wid])

# AFTER (runs the job in this process — no Celery worker container needed):
await asyncio.to_thread(find_match.apply, args=[uid, wid])
```

`asyncio` is already imported in that file. Matching now runs off the event loop on a worker thread — identical behavior at MVP scale, and you **delete the Celery worker from your deployment** entirely.

### 2c. (Only if you ever deploy pose-service) R2 photo fetching

`packages/pose-service/src/main.py` → `_resolve_photo_url()` builds `http://{minio_endpoint}/{bucket}/{key}` — that's MinIO-only. Against R2 (HTTPS + `r2.dev` public URLs) it needs the scheme and the public bucket URL. Since we're not deploying pose-service on the free plan (§10), this is parked until you self-host it.

---

## 3. Step 1 — PostgreSQL → **Neon** (free forever)

| | Neon free plan |
|---|---|
| Storage | 500 MB |
| Compute | 100 CU-hours/month (scales to zero after 5 min idle, ~350 ms resume) |
| Card? | **No** |
| Forever? | **Yes** — no expiry, data never deleted |

1. Sign up at [neon.tech](https://neon.tech) (GitHub/Google login, no card).
2. **New project** → pick a region close to your users → **Create**.
3. Copy the connection string. **Use the pooled one** (`-pooler` in the hostname): the app's pg pool opens up to 20 connections, and Neon free tier is much happier behind its PgBouncer:
   ```
   postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require
   ```
   That exact string becomes `DATABASE_URL` everywhere.

**Run the migrations** (from this repo, once):
```bash
export DATABASE_URL="postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require"

# Option A — you have Docker (works on Windows too, reuses the repo's own runner):
DB_HOST=ep-XXXX-pooler.us-east-2.aws.neon.tech DB_PORT=5432 \
DB_USER=kinetik_user DB_PASSWORD=PASSWORD DB_NAME=kinetik \
docker compose up migration-runner

# Option B — you have psql installed:
psql "$DATABASE_URL" -f scripts/init-db.sql
for f in scripts/migrations/*.sql; do psql "$DATABASE_URL" -1 -f "$f"; done
```

> 💡 Neon stays warm automatically: api-core's location poller queries the DB every 3 minutes, so the compute never hits the 5-minute idle threshold.

---

## 4. Step 2 — Redis ×2 → **Upstash** (free forever)

| | Upstash free plan (per database) |
|---|---|
| Storage | 256 MB |
| Commands | ~500k/month (~16k/day guideline) |
| Databases | Up to 10 free |
| Card? | **No** |

Create **two** databases (this is deliberate — the stack uses one Redis for caching/Socket.IO and a **separate** one for the event bus):

1. **`kinetik-cache`** → the main Redis (`REDIS_*` env vars).
2. **`kinetik-events`** → the event bus (`REDIS_EVENTS_*` env vars).

For each, open the dashboard → **Connect** → copy the TCP details (host, port 6379, password token — the token goes in `REDIS_PASSWORD`). You've already added `tls: {}` in §2a, so plain host/port/password env vars just work.

```
REDIS_HOST=deep-lynx-12345.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=<token>

REDIS_EVENTS_HOST=kind-swan-67890.upstash.io
REDIS_EVENTS_PORT=6379
REDIS_EVENTS_PASSWORD=<token>
```

> ⚠️ **Budget check:** the Socket.IO adapter + rate limiter + location poller will burn a few hundred commands a day at MVP scale — fine. If you start hitting the monthly cap, raise the location-poll TTLs or move Redis to your future paid VPS. Also: **claim** each database into your free account (unclaimed dbs are deleted after 3 days).

---

## 5. Step 3 — Object storage → **Cloudflare R2** (free forever)

| | Cloudflare R2 free |
|---|---|
| Storage | 10 GB-month |
| Egress | **$0 forever** (no download fees — huge for a photo app) |
| Operations | 1M writes + 10M reads/month |
| Card? | **No** |

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → **Create bucket** → name it `kinetik-photos`.
2. **R2 → Manage R2 API Tokens → Create API token** (Object Read & Write on that bucket) → copy Access Key ID + Secret.
3. **Settings → Public access → Create public bucket** (the `*.r2.dev` URL is your public CDN).
4. Add a CORS rule allowing `GET` from `*` (mobile doesn't need it, web preview does).

Because there's no nginx `/uploads/` proxy in the cloud setup, `MINIO_PUBLIC_URL` must be the absolute public bucket URL:

```
MINIO_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret>
MINIO_BUCKET=kinetik-photos
MINIO_USE_SSL=true
MINIO_PUBLIC_URL=https://pub-<hash>.r2.dev
```

Photo URLs are stored in the DB as `https://pub-<hash>.r2.dev/...` — the mobile app's `resolveUrl()` passes absolute URLs through unchanged. Encrypted chat media is served by api-core's own proxy endpoint, so it stays private regardless.

---

## 6. Step 4 — WebRTC (calls) → **LiveKit Cloud** (free forever)

| | LiveKit Cloud "Build" plan |
|---|---|
| Bandwidth | 50 GB downstream/month (upstream free) |
| Call minutes | 5,000 WebRTC minutes/month |
| Card? | **No** |

1. Sign up at [livekit.io](https://livekit.io) → create a project (Build plan).
2. **Settings → Keys** → copy the **host** (`wss://<project>.livekit.cloud`), API key, and API secret.

```
LIVEKIT_HOST=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=APIxxx
LIVEKIT_API_SECRET=<secret>
LIVEKIT_PUBLIC_URL=wss://<project>.livekit.cloud
```

> Don't self-host LiveKit on a free tier — it needs UDP port ranges + TURN, which requires a real VM. The free Build plan is the right call and needs no card.

> **Self-hosting LiveKit instead (e.g. the $5–6 VPS ladder)?** The compose file ships the embedded TURN server — just set `LIVEKIT_TURN_ENABLED=true`, `LIVEKIT_TURN_DOMAIN=turn.<yourdomain>`, `LIVEKIT_TURN_TLS_PORT=443` (unless you have a load balancer in front), and drop a **CA-signed** `turn.crt`/`turn.key` (self-signed won't work) into `config/certs/`. Clients then get `wss://` + TURN automatically. The Build plan above already includes all of this for free.

> **Dev on a physical iPhone over plain `ws://` (LAN)?** iOS ATS would block cleartext WebSockets — `app.json` ships `NSAppTransportSecurity → NSAllowsLocalNetworking: true`, which exempts only local-network connections (RFC1918 IPs) and keeps ATS strict for everything else, so it's App-Store-safe. In production the app always talks `wss://`, which needs no exception.

> **Testing calls over LAN with docker?** Set `LIVEKIT_RTC_NODE_IP=<your machine's LAN IP>` in your `.env` and `docker compose up -d livekit` — without it the LiveKit container advertises its internal docker IP, so the call *connects* but no video/audio flows. Everything else stays `ws://` + TURN off, which is exactly right for LAN dev.

---

## 7. Step 5 — api-core → **Render** (free forever)

| | Render free web service |
|---|---|
| Resources | 512 MB RAM, 1 vCPU |
| Hours | 750 instance-hours/month (**≈ one always-awake service**) |
| Sleep | After 15 min idle → keep-alive pings prevent it |
| Card? | **No** |

> ⚠️ **The 750-hour rule:** one keep-alive'd service uses ~744 h/month, so it *just* fits. **Do not put a second service in this workspace** — it would blow the pool and suspend everything mid-month. Extra services go on Koyeb (§8–9).

**Deploy:**
1. Push this repo to GitHub (public or private — free tier works either way).
2. Render → **New → Web Service** → connect the repo → **Root directory: `/`**.
3. Settings:
   - **Runtime:** Node
   - **Build command:**
     ```
     npm install && npm run build -w packages/shared && npm run build -w packages/api-core
     ```
   - **Start command:**
     ```
     node packages/api-core/dist/index.js
     ```
   - **Instance type:** Free
   - **Health check path:** `/health`
4. Add the **full env var list from §14** (note: Render injects `PORT` itself — don't set it).
5. Deploy. Your public URL is `https://<service-name>.onrender.com` (HTTPS included, free).

**Wire the mobile app later in §12** using this URL as `apiUrl`.

---

## 8. Step 6 — realtime → **Koyeb** (free forever)

| | Koyeb free web service |
|---|---|
| Resources | 512 MB RAM, 0.1 vCPU, 2 GB disk |
| Bandwidth | 100 GB/month |
| Sleep | After **1 hour** idle → keep-alive pings prevent it |
| Card? | **No** |

1. Sign up at [koyeb.com](https://koyeb.com) (free account, no card).
2. **Create App** → deploy from your GitHub repo.
3. Service settings:
   - **Build command:**
     ```
     npm install && npm run build -w packages/shared && npm run build -w packages/realtime
     ```
   - **Run command:**
     ```
     node packages/realtime/dist/index.js
     ```
   - **Port:** `3002`
   - **Public domain:** it'll get `https://<app>.koyeb.app` with HTTPS (or set your own later).
4. Env vars: **`JWT_SECRET` must be identical to api-core's** (it validates the same tokens), plus the Redis vars from §14.
5. Deploy.

WebSocket + long-polling both work through Koyeb. Keep it warm with an UptimeRobot ping to `https://<app>.koyeb.app/socket.io/?EIO=4&transport=polling` (§13).

---

## 9. Step 7 — match-engine → **Koyeb (2nd free account)** + worker tweak

The match-engine (Python + H3, subscribes to the event bus and computes flash-window matches) is a separate always-on process. Koyeb free allows **one** service per account, so use a **second Koyeb account** (different email).

1. New Koyeb account → **Create App** → deploy the same repo.
2. Service settings:
   - **Build method:** Dockerfile → path `packages/match-engine-py/Dockerfile`
   - **Run command:** (empty — use the Dockerfile's default `CMD`)
   - **Port:** `3003`
   - > ⚠️ If your platform builds with **repo-root** as the Docker context instead of the Dockerfile's folder, the Dockerfile's `COPY src/ ./src/` will fail. Fall back to a native build instead: build command `cd packages/match-engine-py && pip install -r requirements-lock.txt`, run command `cd packages/match-engine-py && python -m src.main`.
3. Env vars: `DATABASE_URL`, `REDIS_*`, `REDIS_EVENTS_*` (§14), `PORT=3003`, `ENVIRONMENT=production`.
4. Deploy. Keep it awake with an UptimeRobot ping to `https://<app>.koyeb.app/health` (§13).

**The Celery worker** — apply the §2b tweak (`find_match.apply` in-process) and simply **don't deploy the worker**. Matching runs inside the match-engine process. Reintroduce a real worker when you move to a paid VM.

> Note: the event bus is **fire-and-forget pub/sub** — if the match-engine is asleep when an event fires, that event is missed (matches process on the next window). Keep-alive pings make this a non-issue in practice. This is the one accepted trade-off of the free plan.

---

## 10. Step 8 — pose-service: the honest section

**Why there's no free home:** it needs OpenCV + MediaPipe (≈1 GB RAM minimum at runtime, huge wheels) — every no-card free tier tops out at 512 MB, and Hugging Face (the old answer) now charges for Docker Spaces.

**Why that's OK — it's optional by design:**
- `packages/api-core/src/routes/poseVerification.ts` calls the pose-service inside a `try/catch` with a timeout and **never blocks onboarding**: `"User can proceed with onboarding regardless of the result."` Users just get `pending` instead of `verified`.
- Only the KYC "verify face on ID" endpoint (`/api/v1/kyc/verify-face`) hard-requires it — and KYC is a per-user opt-in feature.

**Your free-forever options, in order of preference:**
1. **Ship without it now** (zero cost, zero changes). Verification stays `pending` until you decide otherwise.
2. **Move liveness to the phone** (recommended when you want real verification): MediaPipe runs natively on-device — `PoseVerificationScreen.tsx` already captures the selfie; the check can run in the app and report back. No hosting at all, works forever, free.
3. **Self-host it later** on your future $5 VPS (or home machine) and set `POSE_SERVICE_URL` — zero code changes needed on the API side.

Don't leave `POSE_SERVICE_URL` pointing at `http://localhost:3004` — leave it unset so the calls fail fast (and gracefully) rather than hanging.

---

## 11. Step 9 — Third-party APIs (all free, no card)

| Need | Service | Free tier | Env vars |
|---|---|---|---|
| Push notifications | **Expo Push** | Free (send as many as your volume allows; works via `expo-server-sdk`) | `EXPO_ACCESS_TOKEN` *(optional)* |
| Reverse geocoding | **Geoapify** | 3,000 credits/day (the location poller uses ~1/user/3min) | `GEOAPIFY_API` |
| SMS OTP | **Deferred** — see note | — | `SMS_DISABLED=true` |
| Payments | **Razorpay** | Test mode keys are free & unlimited | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Errors | **Sentry** | 5k errors/month | — |
| Logs | **Better Stack** | 100k logs/month | — |

**SMS OTP note (read this):** `generateOtp()` in `packages/api-core/src/routes/auth.ts` currently returns `'123456'` for everyone — SMS is effectively stubbed. Set `SMS_DISABLED=true` so the app logs OTPs instead of trying Twilio. When you launch for real: Twilio's $15 trial credit is *not* forever, so plan on a pay-as-you-go SMS provider (Twilio ~$0.0079/SMS, or an India-focused provider like Fast2SMS/MSG91 with small free credits). That's a per-message cost, not a hosting cost — and it's optional today.

**Payments note:** Razorpay test keys work forever for development. Live mode requires business KYC and takes a ~2% per-transaction fee — normal for any payment provider, not a hosting cost.

---

## 12. Step 10 — Mobile app: URLs + distribution

**Point the app at your free URLs** — edit `packages/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "apiUrl": "https://<api-core>.onrender.com",
  "wsUrl":  "https://<realtime>.koyeb.app"
}
```

`config.ts` reads both; `resolveUrl()` passes absolute R2 URLs through untouched.

**Build & distribute (all free):**
- **Build:** Expo EAS Build free tier (30 builds/month) — `eas build -p android --profile preview`.
- **Android:** publish the APK as a **GitHub Release** — free, permanent links, no expiry. (Google Play is a **one-time $25** fee when you're ready — not a subscription, but not zero either.)
- **iOS:** TestFlight is free but requires an **Apple Developer account ($99/year)** — the one genuinely unavoidable cost in the entire stack. Skip iOS until you decide it's worth it.

---

## 13. Step 11 — Keep-alive & monitoring (UptimeRobot)

Free tier: 50 monitors, 5-minute checks. These do double duty — **health checks** and **anti-sleep pings**:

| Monitor | Type | URL / host | Why |
|---|---|---|---|
| api-core | HTTP(S) | `https://<api-core>.onrender.com/health` | keeps Render awake + health |
| realtime | HTTP(S) | `https://<realtime>.koyeb.app/socket.io/?EIO=4&transport=polling` | keeps Koyeb awake + Socket.IO sanity (expect `0{` in body) |
| match-engine | HTTP(S) | `https://<match>.koyeb.app/health` | keeps Koyeb awake + health |
| Neon DB | TCP | `ep-XXXX-pooler.us-east-2.aws.neon.tech:5432` | optional belt-and-braces (api-core's poller already keeps it warm) |
| LiveKit | TCP | `<project>.livekit.cloud:443` | sanity only |

---

## 14. Full environment variable reference

### api-core (Render)

```
NODE_ENV=production
DATABASE_URL=postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require
JWT_SECRET=<long-random-string>          # ⚠️ MUST match realtime exactly
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
MINIO_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret>
MINIO_BUCKET=kinetik-photos
MINIO_USE_SSL=true
MINIO_PUBLIC_URL=https://pub-<hash>.r2.dev
GEOAPIFY_API=<geoapify-key>
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=<razorpay-test-secret>
SMS_DISABLED=true
EXPO_ACCESS_TOKEN=            # optional
POSE_SERVICE_URL=             # leave unset
```

### realtime (Koyeb)

```
JWT_SECRET=<long-random-string>          # ⚠️ MUST match api-core exactly
DATABASE_URL=postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require
REDIS_HOST=<cache>.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=<token>
REDIS_EVENTS_HOST=<events>.upstash.io
REDIS_EVENTS_PORT=6379
REDIS_EVENTS_PASSWORD=<token>
```

### match-engine (Koyeb #2)

```
ENVIRONMENT=production
DATABASE_URL=postgresql://kinetik_user:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/kinetik?sslmode=require
REDIS_HOST=<cache>.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=<token>
REDIS_EVENTS_HOST=<events>.upstash.io
REDIS_EVENTS_PORT=6379
REDIS_EVENTS_PASSWORD=<token>
```

---

## 15. End-to-end deployment checklist

- [ ] **Code tweaks (§2):** TLS lines in 5 Node spots; `rediss://`/`ssl=True` in 2 Python spots; Celery in-process tweak
- [ ] **Neon:** create project → copy **pooled** `DATABASE_URL` → run migrations
- [ ] **Upstash:** create `kinetik-cache` + `kinetik-events` → claim both → copy host/token
- [ ] **Cloudflare R2:** bucket `kinetik-photos` → API token → public access (`*.r2.dev`) → CORS
- [ ] **LiveKit Cloud:** project → copy host + key + secret
- [ ] **Render (api-core):** deploy → set env vars → note `.onrender.com` URL
- [ ] **Koyeb #1 (realtime):** deploy → set env vars → note `.koyeb.app` URL
- [ ] **Koyeb #2 (match-engine):** deploy via Dockerfile → set env vars → note URL
- [ ] **UptimeRobot:** add 3–5 monitors (§13) — this is what keeps everything awake
- [ ] **Mobile:** set `apiUrl`/`wsUrl` in `app.json` → `eas build` → upload APK to GitHub Releases
- [ ] **Verify:** signup (OTP `123456` in dev) → onboarding → photo upload (check R2) → like/matcher → chat → call (LiveKit)

---

## 16. Scaling up later (your "switch to a better plan" path)

Nothing here is a dead end — every service above can run on the repo's existing `docker-compose.yml` unchanged. The ladder:

| When | Move | Cost |
|---|---|---|
| You want no sleep, ever, no card | Old PC / Raspberry Pi 5 at home + **Cloudflare Tunnel** (free) → `docker compose up -d` → tunnel exposes nginx on 8080 | $0 forever |
| You get a card for signup verification | **Oracle Cloud Always Free** ARM VM (4 OCPU/24 GB — runs the whole compose file) | $0 forever |
| You're ready to pay for polish | **Hetzner / DigitalOcean $5–6 VPS** + docker compose (this repo ships everything: postgres, redis, redis-events, minio, nginx, livekit, all 4 services) | ~$5–6/mo |
| You outgrow it all | Same compose file, bigger box | your choice |

The repo's `docker-compose.yml` is the one truth — Render/Koyeb/Neon/Upstash/R2/LiveKit are just its free-tier mirror image.

---

## 17. What still can't be free forever (honest list)

| Item | Why | Workaround today |
|---|---|---|
| iOS distribution | Apple Developer $99/year | Ship Android APKs via GitHub Releases; skip iOS |
| Custom domain | ~$8–12/year | Free `*.onrender.com` / `*.koyeb.app` subdomains (HTTPS included) |
| SMS at scale | Per-message fees | OTP currently logs `123456` (`SMS_DISABLED=true`) — add a provider when you launch |
| Live payments | Razorpay ~2%/transaction | Test keys are free & unlimited |
| pose verification | Needs ~1 GB RAM container | Optional by design; go client-side later (§10) |

---

## 18. Appendix — gotchas discovered while wiring the real code

1. **Render 750 h/month = one awake service per workspace.** A second service in the same workspace will suspend everything when hours run out.
2. **Neon free ≈ 10–20 connections.** Always use the `-pooler` hostname in `DATABASE_URL`; the app opens a 20-connection pool.
3. **Upstash is TLS-only on TCP.** No `tls: {}` → ioredis silently retries forever. (The code change in §2a is mandatory.)
4. **OTP is hardcoded `123456`** (`generateOtp()` in `routes/auth.ts`) — don't burn SMS credits until you change that.
5. **JWT_SECRET must be byte-identical** across api-core and realtime, or every Socket.IO connection is rejected.
6. **KYC "verify face" (502s if pose-service is down)** — the only endpoint that hard-depends on it; KYC is opt-in.
7. **Don't self-host LiveKit on free tiers** — UDP ranges + TURN need a real VM; LiveKit Cloud Build plan is free and cardless.
8. **Event bus is pub/sub, not Kafka** — a sleeping match-engine misses events. Keep-alive pings every 5 min prevent that in practice.
9. **Photos must be served from R2 (`*.r2.dev`), not `/uploads/`** — there's no nginx in the cloud path. `MINIO_PUBLIC_URL` must be absolute.
10. **Back up Neon weekly.** Free tiers don't ship backups. A GitHub Actions cron (`pg_dump` → upload to R2 via `rclone`) costs nothing and runs forever.
