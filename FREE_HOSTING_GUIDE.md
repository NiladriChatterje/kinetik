# Kinetik — Free Forever Hosting Guide

> **Last updated:** July 19, 2026
> **Goal:** Deploy the entire Kinetik app stack completely free, forever (no trials, no credit card surprises).

## The Reality Check

Hosting a full stack like Kinetik (Node.js, Python/OpenCV, PostgreSQL, Redis, MinIO, LiveKit) **entirely for free with no sleep and no credit card** is extremely challenging. Most platforms either:

- **Sleep/idle** after inactivity (Render, Supabase, Koyeb)
- **Require a credit card** for signup (Railway, Fly.io, Backblaze B2)
- **Have hard limits** that are too small for production (Redis Cloud 30MB)
- **Are difficult to get approved** (Oracle Cloud Always Free)

**Strategy:** Use a **hybrid approach** — mix and match the best free tiers from different providers. Don't expect a single platform to host everything.

---

## 1. PostgreSQL Database

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Neon DB** | 100 CU-hours/month, 500MB storage | ❌ No | Scales to zero (cold start after inactivity); generous for dev |
| **Supabase** | 500MB DB, 1GB RAM | ❌ No | Pauses after 1 week of inactivity |
| **Aiven** | 5GB storage, 1 CPU | ❌ No | Also pauses after inactivity |

**Recommendation:** **Neon DB** — best free Postgres with no credit card. The scale-to-zero delay (~1-2 seconds) is acceptable for a dating app where users don't expect immediate DB responses at all times.

**Setup:**
```bash
# No setup needed — just create a project at https://neon.tech
# Get your connection string:
DATABASE_URL="postgresql://user:pass@ep-xxxx.us-east-2.aws.neon.tech/kinetik"
```

---

## 2. Redis (Cache + Pub/Sub)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Upstash** | 10MB — 100MB depending on plan | ❌ No | Serverless Redis, excellent for pub/sub; cold start on first request |
| **Redis Cloud** | 30MB | ⚠️ Sometimes | May ask for card on signup; 30MB is too small for prod |
| **Aiven** | 250MB | ❌ No | Managed Redis, scales to zero |

**Recommendation:** **Upstash** — serverless Redis with a generous free tier that works perfectly for Socket.IO pub/sub and caching. No credit card needed.

> **⚠️ Note:** The event bus requires a **second Redis instance** (see Section 3). Create two Upstash databases — one for caching/pub-sub (`redis`) and one for the event bus (`redis-events`). The Kinetik stack uses separate connection strings for each.

**Setup:**
```bash
# Create TWO Upstash databases:
# 1. Main Redis (caching + Socket.IO adapter + presence)
UPSTASH_REDIS_URL="redis://default:token@xxxx.upstash.io:6379"

# 2. Event Bus Redis (dedicated pub/sub — replaces Kafka)
REDIS_EVENTS_URL="redis://default:token@yyyy.upstash.io:6379"
```

---

## 3. Event Bus (Redis Pub/Sub)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Upstash** | 10MB — 100MB depending on plan | ❌ No | Serverless Redis; pub/sub is instant, no partitions to manage |
| **Aiven** | 250MB | ❌ No | Managed Redis, scales to zero after inactivity |

**Recommendation:** **Upstash** — a second Upstash Redis instance dedicated to the event bus. The Kinetik stack now uses Redis pub/sub channels (`event:match`, `event:user`, `event:window`, `event:vibe`, `event:payment`) instead of Kafka topics. This is simpler, cheaper (no broker to manage), and faster (~1ms pub/sub latency vs ~5-10ms for Kafka).

**Why Redis instead of Kafka for the event bus:**
- Redis pub/sub is built-in — no partitions, consumer groups, or broker config
- Starting a second Redis container uses ~256MB vs Kafka + Zookeeper ~2GB
- On free tiers, Upstash Aiven's Redis is more generous than Aiven's Kafka
- The event bus doesn't need Kafka's message durability/replay guarantees — if a service is down, it misses the event (acceptable for match/like notifications)

**Setup:**
```bash
# Create a second Upstash database specifically for event bus
REDIS_EVENTS_URL="redis://default:token@yyyy.upstash.io:6379"
```

---

## 4. Object Storage (MinIO)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Cloudflare R2** | 10GB storage, 10M writes/month | ❌ No | S3-compatible, zero egress fees! Best option |
| **Backblaze B2** | 10GB storage | ⚠️ Yes | Requires credit card for verification |
| **Self-hosted MinIO** | Unlimited (on VPS) | Varies | Requires a VM with persistent storage |

**Recommendation:** **Cloudflare R2** — 10GB free forever, S3-compatible API, and zero egress fees (you don't pay for downloads). Perfect for profile photos and KYC documents.

**Setup:**
```bash
# Create a bucket at https://dash.cloudflare.com → R2
S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
S3_ACCESS_KEY="your-access-key"
S3_SECRET_KEY="your-secret-key"
S3_BUCKET="kinetik-photos"

# Update api-core and pose-service to use R2 instead of MinIO
```

---

## 5. Node.js Backend (API Core + Realtime Service)

### Option A: Single VPS (Best for "No Sleep")

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Oracle Cloud Always Free** | Up to 4 ARM cores, 24GB RAM, 200GB storage | ⚠️ Yes | Extremely hard to get approved; rejection rate is high |
| **Google Cloud Free Tier** | 1 f1-micro VM (0.2 vCPU, 0.6GB) per month | ⚠️ Yes | Only 1 month free for the VM; after that it's paid |
| **AWS Free Tier** | 1 t2.micro for 12 months | ⚠️ Yes | **Expires after 12 months** — NOT free forever |

**Oracle Cloud Always Free** is the only true "free forever" VM that can run Node.js 24/7 without sleeping. But getting approved is notoriously difficult.

### Option B: PaaS (Sleeps on Inactivity)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Render** | 512MB RAM, 1 vCPU | ❌ No | Sleeps after 15 minutes idle; cold start delays |
| **Koyeb** | 1 app, 512MB RAM | ❌ No | Sleeps after inactivity |
| **Fly.io** | 3 shared VMs, 256MB each | ⚠️ Card required | Free allowance but needs card to sign up |

### Option C: Worker/Edge (Stateless)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Cloudflare Workers** | 100k requests/day | ❌ No | Edge functions — no persistent connections (Socket.IO won't work) |

**Recommendation:** **Render** + keep-alive pings from UptimeRobot (free). Two Node.js services (api-core + realtime) on Render's free tier. Add UptimeRobot to ping every 5 minutes to prevent sleeping.

**Setup:**
```bash
# Deploy api-core:
# 1. Build type: Node
# 2. Build command: cd packages/api-core && npm install && npm run build
# 3. Start command: node dist/index.js
# 4. Health check path: /health

# Deploy realtime:
# 1. Build command: cd packages/realtime && npm install && npm run build
# 2. Start command: node dist/index.js
# 3. Port: 3002
```

---

## 6. Python Services (Pose Service + Match Engine)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **Render** | 512MB RAM, 1 vCPU | ❌ No | Same as Node.js — sleeps after 15 min |
| **Koyeb** | 1 app, 512MB RAM | ❌ No | Same sleep behavior |
| **Hugging Face Spaces** | 2 vCPU, 16GB RAM (CPU only) | ❌ No | Docker support, no sleep! Good for Python apps |
| **Google Colab** | GPU access | ❌ No | Session-based, not for production |

**Recommendation:** **Hugging Face Spaces** — Docker-based, doesn't sleep, has generous CPU resources. Perfect for the pose-service (Python + OpenCV/MediaPipe).

**⚠️ Important:** MediaPipe + OpenCV requires significant RAM. The pose-service needs at least 1GB RAM during face detection. Render's free tier (512MB) may not be enough.

**Setup:**
```bash
# Hugging Face Space:
# 1. Create a Docker Space
# 2. Set port to 3004
# 3. The space stays alive as long as it's accessed occasionally
```

---

## 7. LiveKit (WebRTC SFU)

| Service | Free Tier | Credit Card? | Caveats |
|---------|-----------|-------------|---------|
| **LiveKit Cloud** | 50 GB bandwidth/month | ❌ No | Free forever, no credit card! Matches small-scale needs |
| **Self-hosted** | On VPS | Varies | Resource-heavy (UDP ports, TURN server complexity) |

**Recommendation:** **LiveKit Cloud** — their free tier is generous for a dating app starting out. 50GB bandwidth is enough for thousands of minutes of calls.

**Setup:**
```bash
# Sign up at https://livekit.io
LIVEKIT_HOST="https://your-project.livekit.cloud"
LIVEKIT_API_KEY="APIxxxx"
LIVEKIT_API_SECRET="your-secret"
```

---

## 8. Mobile App Distribution

| Service | Free Tier | Details |
|---------|-----------|---------|
| **GitHub Releases** | Unlimited | Host APK/IPA files as release artifacts; permanent download links |
| **Expo EAS** | 30 builds/month | Free tier for builds; distribute via Expo Go for testing |
| **Google Play Console** | $25 one-time fee | Required for Play Store distribution (NOT free, but one-time) |
| **TestFlight (iOS)** | Free | Requires Apple Developer account ($99/year) |

**Recommendation:**
- **Android:** Use **GitHub Releases** to distribute APK files for free (permanent links, no expiry)
- **iOS:** TestFlight (free, but requires $99/year Apple Developer account — this is the only unavoidable cost)

---

## 9. Domain Name

| Service | Free Tier | Details |
|---------|-----------|---------|
| **Cloudflare Pages** | Free `*.pages.dev` subdomain | Can front your apps |
| **Render** | Free `*.onrender.com` subdomain | For each web service |
| **nip.io / sslip.io** | Free wildcard DNS | Point to any IP for testing |
| **Freenom** | Free `*.tk` domains | Previously free, but unreliable |

For production, you'll need a real domain (~$10-15/year from Namecheap or Cloudflare Registrar). This is unavoidable for SSL/professionalism.

---

## 10. Monitoring & Uptime

| Service | Free Tier | Purpose |
|---------|-----------|---------|
| **UptimeRobot** | 50 monitors, 5-min checks | Ping your Render/HF services to prevent sleeping |
| **Sentry** | 5k errors/month | Error tracking for debugging |
| **Better Stack** | 3 users, 100k logs/month | Centralized logging |

---

## Recommended Architecture (Free Forever)

```
┌─────────────────────────────────────────────────────┐
│                    Users                             │
├─────────────────────────────────────────────────────┤
│         Mobile App (GitHub Releases APK)            │
└────────────┬────────────────────────┬───────────────┘
             │ HTTPS                  │ WebSocket
             ▼                        ▼
┌─────────────────────┐   ┌─────────────────────────┐
│  Render (Web)       │   │  Render (WebSocket)      │
│  api-core (Fastify) │   │  realtime (Socket.IO)    │
│  → Sleeps w/ pings  │   │  → Sleeps w/ pings       │
└──────────┬──────────┘   └──────────┬──────────────┘
           │                         │
           ▼                         ▼
┌───────────────────────────────────────────────────────┐
│             Upstash Redis (Event Bus)                  │
│  event:match, event:user, event:window, event:vibe,   │
│  event:payment — replaces Kafka topics                │
└────────────────────────┬──────────────────────────────┘
                         │
                         ▼
┌─────────────────────┐   ┌────────────────────────────┐
│  Neon DB (Postgres) │   │  Cloudflare R2 (Photos)    │
│  Scale-to-zero      │   │  10GB free, no egress fee  │
└─────────────────────┘   └────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  Hugging Face Space (pose-service)                    │
│  Python + OpenCV + MediaPipe, no sleep                │
│  → No GPU (CPU only) — acceptable for selfie match    │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  LiveKit Cloud (WebRTC SFU)                           │
│  50GB free bandwidth, no credit card                  │
└───────────────────────────────────────────────────────┘
```

---

## What WON'T Work Free Forever

| Component | Why It's Hard | Alternative |
|-----------|--------------|-------------|
| **Match Engine Python (GPU)** | No free GPU hosting for production | Run on CPU (slower but works for small scale) |
| **Kafka** | ❌ **Already replaced** | Replaced with second Upstash Redis instance — simpler and free |
| **Full LiveKit** | TURN server + UDP ports are expensive | Use LiveKit Cloud free tier (50GB) |
| **iOS Distribution** | $99/year Apple Developer fee | Only unavoidable cost — no way around it |
| **Custom Domain** | $10-15/year domain registration | Use free `*.onrender.com` subdomain |

---

## Step-by-Step Deployment Checklist

- [ ] **Neon DB:** Create project → run migrations → copy connection string
- [ ] **Upstash Redis (caching):** Create database → copy REST URL + token
- [ ] **Upstash Redis (event bus):** Create second database → copy REST URL + token
- [ ] **Cloudflare R2:** Create bucket → generate API token → configure CORS
- [ ] **LiveKit Cloud:** Create project → get API key + secret
- [ ] **Render (api-core):** Deploy Fastify app → set env vars → note `.onrender.com` URL
- [ ] **Render (realtime):** Deploy Socket.IO app → set env vars → note WebSocket URL
- [ ] **Hugging Face Spaces (pose-service):** Deploy Docker → set env vars → note Space URL
- [ ] **Verify:** Update mobile app's `config.ts` with all URLs → rebuild → upload APK to GitHub Releases
- [ ] **UptimeRobot:** Add monitors for all services → prevents sleeping
- [ ] **Test:** Full end-to-end flow (signup → match → chat → call)

---

## Notes

- **Sleeping services:** Render and Hugging Face Spaces may spin down after periods of no traffic. UptimeRobot (free) pings them every 5 minutes to keep them warm.
- **Mobile app:** Expo EAS Build (free tier) can build your APK/IPA. You'll need a computer to run `eas build` periodically.
- **Scaling up:** When you outgrow the free tier, migrate to a $5-10/month Hetzner or DigitalOcean VPS running Docker Compose (all services on one box).
- **Backup:** Always keep your PostgreSQL backed up locally. Use `pg_dump` weekly.
