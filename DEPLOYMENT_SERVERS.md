# Kinetik Backend — Deployment Server Guide

> Target: **10,000 registered users**, ~1,000–2,000 concurrent at peak
> Requirements: Socket.IO (persistent WebSocket), pose verification (CPU-heavy ML), 100% uptime
> Date: August 2026

---

## Resource Requirements (10K Users)

Your Docker Compose stack runs 8 services. Here's what each needs at 10K scale:

| Service | CPU | RAM | Notes |
|---------|-----|-----|-------|
| PostgreSQL | 1–2 | 1–2 GB | Main DB, connection pooling critical |
| Redis (cache + Socket.IO adapter) | 0.5–1 | 512 MB–1 GB | Presence data, session cache |
| Redis (event bus) | 0.25 | 256 MB | Pub/sub only |
| API Core (Node.js) | 1–2 | 512 MB–1 GB | REST endpoints |
| Realtime (Socket.IO) | 1–2 | 512 MB–1 GB | 1K+ persistent WS connections |
| Pose Service (Python/MediaPipe) | 2–4 | 1–2 GB | **CPU bottleneck** — ML inference |
| Nginx | 0.25 | 64 MB | Reverse proxy |
| MinIO | 0.5 | 512 MB | Object storage (photos) |
| **Total** | **6–10** | **5–8 GB** | |

**Minimum viable server:** 6 vCPU, 8 GB RAM, 80 GB SSD
**Recommended for comfort:** 8 vCPU, 16 GB RAM, 160 GB SSD

---

## Why Pose Verification is the Bottleneck

MediaPipe face landmark extraction on CPU takes **200–500ms per image**. At peak:
- 50 verifications/minute = 10–25 seconds of CPU time/minute
- With 2 dedicated CPU cores, this saturates ~50–100% of one core
- **This is why you need dedicated cores, not shared/burstable**

---

## Server Options (Ranked by Price-Performance)

### Tier 1: Best Value (Recommended)

#### 🏆 Hetzner Cloud — CPX (Cost-Optimized) / CAX (ARM)

| Plan | vCPU | RAM | SSD | Bandwidth | Price/mo | Best For |
|------|------|-----|-----|-----------|----------|----------|
| CPX41 | 8 vCPU (shared) | 16 GB | 240 GB | 20 TB | **~$38** | Budget 10K, bursty load |
| CPX51 | 16 vCPU (shared) | 32 GB | 480 GB | 20 TB | **~$67** | Comfortable 10K |
| CAX41 | 8 vCPU (shared ARM) | 16 GB | 240 GB | 20 TB | **~$35** | ARM-compatible stack |
| CCX13 | 2 vCPU (dedicated) | 8 GB | 80 GB | 20 TB | **~$33** | Start small, upgrade later |
| CCX23 | 4 vCPU (dedicated) | 16 GB | 80 GB | 20 TB | **~$52** | **Best for 10K users** |
| CCX33 | 8 vCPU (dedicated) | 32 GB | 160 GB | 20 TB | **~$92** | High-traffic 10K+ |

**Why Hetzner wins:**
- Cheapest dedicated vCPU in the market
- 20 TB included bandwidth (generous)
- Free snapshots, firewalls, floating IPs
- EU-based (GDPR-friendly), data centers in US (Ashburn, VA)
- No egress fees

**⚠️ CPX (shared) caveat:** CPU-intensive pose verification may slow down under "noisy neighbor" conditions. **CCX (dedicated) is safer for your workload.**

**🏆 Recommendation: Hetzner CCX23 (4 dedicated vCPU, 16 GB RAM) — ~$52/mo**

---

### Tier 2: Good Global Coverage

#### DigitalOcean — Droplets

| Plan | vCPU | RAM | SSD | Transfer | Price/mo |
|------|------|-----|-----|----------|----------|
| Basic 8 GB | 4 vCPU (shared) | 8 GB | 160 GB | 5 TB | **$48** |
| Basic 16 GB | 8 vCPU (shared) | 16 GB | 320 GB | 6 TB | **$96** |
| CPU-Optimized 4 GB | 2 vCPU (dedicated) | 4 GB | 25 GB | 4 TB | **$42** |
| CPU-Optimized 8 GB | 4 vCPU (dedicated) | 8 GB | 50 GB | 5 TB | **$84** |
| CPU-Optimized 16 GB | 8 vCPU (dedicated) | 16 GB | 100 GB | 6 TB | **$168** |
| General Purpose 8 GB | 2 vCPU (dedicated) | 8 GB | 25 GB | 4 TB | **$63** |
| General Purpose 16 GB | 4 vCPU (dedicated) | 16 GB | 50 GB | 5 TB | **$126** |

**Why DigitalOcean:**
- Excellent docs, 1-click Docker droplet
- Managed PostgreSQL/Redis add-ons ($15–30/mo each)
- Load balancers ($12/mo) for HA
- 20+ data centers worldwide

**🏆 Recommendation: DO CPU-Optimized 16 GB (8 dedicated vCPU) — $168/mo**
*(2x Hetzner price, but better ecosystem for managed services)*

---

#### Vultr — VX1 / High Frequency

| Plan | vCPU | RAM | SSD | Bandwidth | Price/mo |
|------|------|-----|-----|-----------|----------|
| VX1 General 2C/8G | 2 vCPU | 8 GB | Block | 5 TB | **~$43** |
| VX1 General 4C/16G | 4 vCPU | 16 GB | Block | 6 TB | **~$86** |
| VX1 NVMe 2C/8G | 2 vCPU | 8 GB | 120 GB NVMe | 5 TB | **~$55** |
| HF 4C/8G | 4 vCPU | 8 GB | 320 GB NVMe | 5 TB | **$96** |

**Why Vultr:**
- Global presence (32 locations)
- NVMe storage (fast disk I/O for PostgreSQL)
- Bare metal option for extreme performance
- $250 free credit for new accounts

**🏆 Recommendation: Vultr VX1 4C/16G — ~$86/mo**

---

### Tier 3: Managed / Enterprise-Grade

#### AWS Lightsail

| Plan | vCPU | RAM | SSD | Transfer | Price/mo |
|------|------|-----|-----|----------|----------|
| 8 GB | 2 vCPU (dedicated) | 8 GB | 160 GB | 5 TB | **$44** |
| 16 GB | 4 vCPU (dedicated) | 16 GB | 320 GB | 6 TB | **$84** |
| 32 GB | 8 vCPU (dedicated) | 32 GB | 640 GB | 7 TB | **$164** |

**Why Lightsail:**
- Simple pricing, easy to migrate to full EC2 later
- Bundled static IP, DNS, monitoring
- Snapshots for backups
- Can attach RDS (managed PostgreSQL) later

**Caveat:** Lightsail is cheap, but egress over 1 TB costs $0.09/GB. At 10K users with photo-heavy profiles, you could hit $10–30/mo in bandwidth overages.

**🏆 Recommendation: Lightsail 16 GB — $84/mo**

---

#### Railway / Render / Fly.io (Platform-as-a-Service)

| Platform | Estimate for 10K | Pros | Cons |
|----------|------------------|------|------|
| Railway | ~$20–40/mo | Git push deploy, auto-scaling | CPU limits, cold starts |
| Render | ~$85–170/mo | Managed DB, auto-deploy | Expensive at scale |
| Fly.io | ~$50–100/mo | Edge deployment, containers | Complex config, learning curve |

**Verdict:** Fine for MVP/staging, but **VPS wins at 10K users** for cost and control.

---

## Achieving 100% Uptime

### Option A: Single Server + Snapshots (~$50–90/mo)
```
┌─────────────────────────────────────┐
│  Single VPS (Hetzner CCX23)        │
│  ┌─────────────────────────────┐    │
│  │ Docker Compose Stack        │    │
│  │ ├── PostgreSQL              │    │
│  │ ├── Redis × 2               │    │
│  │ ├── API Core                │    │
│  │ ├── Realtime (Socket.IO)    │    │
│  │ ├── Pose Service            │    │
│  │ ├── MinIO                   │    │
│  │ └── Nginx                   │    │
│  └─────────────────────────────┘    │
│  + Daily snapshots (automatic)      │
│  + Docker health checks + restart   │
└─────────────────────────────────────┘
```
- **Uptime: ~99.9%** (planned maintenance = brief downtime)
- **Cost: $52/mo**
- **Risk:** Single point of failure. If the server dies, everything goes down until you restore from snapshot.

### Option B: Managed DB + Single App Server (~$80–120/mo) ⭐ RECOMMENDED
```
┌──────────────────┐     ┌──────────────────────┐
│ Managed Postgres  │     │  VPS (Hetzner CCX23)  │
│ (Hetzner/Digital  │     │  ┌──────────────────┐ │
│  Ocean Managed DB)│◄───►│  │ Docker Stack     │ │
│                   │     │  │ ├── API Core     │ │
│  ~$15–20/mo       │     │  │ ├── Realtime     │ │
└──────────────────┘     │  │ ├── Pose Service  │ │
┌──────────────────┐     │  │ ├── MinIO         │ │
│ Managed Redis     │     │  │ └── Nginx        │ │
│ (Hetzner/Digital  │◄───►│  └──────────────────┘ │
│  Ocean Managed DB)│     │                        │
│  ~$10–15/mo       │     │  $52/mo                │
└──────────────────┘     └──────────────────────┘
```
- **Uptime: ~99.95%** (managed DBs have their own HA)
- **Cost: $52 (server) + $25 (managed DB + Redis) = ~$77/mo**
- **Why:** If the app server dies, your data is safe. Restore in minutes. Managed DBs handle backups, failover, and patching.

### Option C: Two Servers + Load Balancer (~$120–180/mo)
```
┌────────────────┐     ┌──────────────────┐
│ Load Balancer   │────►│ App Server 1      │
│ (Hetzner LB /   │     │ (Hetzner CCX23)  │
│  DigitalOcean   │────►│ $52/mo            │
│  LB $12/mo)     │     ├──────────────────┤
└────────────────┘     │ App Server 2      │
                        │ (Hetzner CCX23)  │
                        │ $52/mo            │
                        └──────────────────┘
         ┌──────────────────┐
         │ Managed Postgres  │
         │ + Managed Redis   │
         │ ~$30/mo           │
         └──────────────────┘
```
- **Uptime: ~99.99%** (redundant app servers)
- **Cost: ~$146/mo**
- **Overkill for 10K users** — but future-proofs to 50K+

---

## My Recommendation

### For 10K Users at Lowest Cost:

| Component | Provider | Plan | Cost/mo |
|-----------|----------|------|---------|
| **App Server** | Hetzner Cloud | CCX23 (4 dedicated vCPU, 16 GB) | $52 |
| **Managed PostgreSQL** | Hetzner Cloud | Managed Postgres S (8 GB RAM) | ~$15 |
| **Managed Redis** | Hetzner Cloud | Managed Redis S (1 GB) | ~$10 |
| **Domain + DNS** | Cloudflare | Free | $0 |
| **SSL** | Let's Encrypt | Free (certbot) | $0 |
| **Monitoring** | UptimeRobot | Free tier | $0 |
| **Backups** | Hetzner Snapshots | Included (1/mo free) | $0 |
| | | **Total** | **~$77/mo** |

### Scaling Path:

| Users | Server | Cost/mo |
|-------|--------|---------|
| 0–5K | Hetzner CPX41 (8 shared vCPU, 16 GB) | ~$38 |
| 5K–10K | Hetzner CCX23 (4 dedicated vCPU, 16 GB) | ~$52 |
| 10K–25K | Hetzner CCX33 (8 dedicated vCPU, 32 GB) | ~$92 |
| 25K–50K | 2× CCX33 + Hetzner LB | ~$196 |
| 50K–100K | Managed K8s or split services | ~$300+ |

---

## Critical Production Setup

### 1. Add pgBouncer (Connection Pooling)
Your PostgreSQL `max_connections` should stay under 100. With 8 services hitting the DB, pgBouncer is mandatory:

```yaml
# Add to docker-compose.yml
pgbouncer:
  image: edoburu/pgbouncer:1.23.1
  environment:
    DATABASE_URL: postgresql://kinetik:password@postgres:5432/kinetik
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 200
    DEFAULT_POOL_SIZE: 20
  ports:
    - "6432:6432"
  depends_on:
    postgres:
      condition: service_healthy
```

### 2. Add Swap Space
Even with 16 GB RAM, a spike (mass onboarding event) can OOM. Add 4 GB swap:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. Docker Production Settings
```yaml
# Add to docker-compose.yml top level
services:
  api-core:
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 1G
    restart: always
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

### 4. Nginx Tuning for 10K WebSocket Connections
```nginx
worker_rlimit_nofile 65535;
events {
    worker_connections 10240;
}
upstream realtime {
    server realtime:3002;
    keepalive 64;
}
server {
    location /socket.io/ {
        proxy_pass http://realtime;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;  # Keep WS alive 24h
    }
}
```

### 5. Uptime Monitoring
- **UptimeRobot** (free): Monitor HTTP, TCP, ping every 5 min
- **BetterStack** (free tier): Real-time status page
- Add a `/health` endpoint that checks DB, Redis, MinIO connectivity

---

## Quick Start (Hetzner)

```bash
# 1. Create account at hetzner.com/cloud

# 2. Create server
#    - CPX41 or CCX23 (your choice based on budget)
#    - Ubuntu 24.04
#    - Location: Ashburn, VA (closest to your users)
#    - Enable IPv4 + IPv6

# 3. SSH in and install Docker
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh
apt install docker-compose-v2 -y

# 4. Clone your repo
git clone <your-repo> /opt/kinetik
cd /opt/kinetik

# 5. Set production env vars
cp .env.example .env
# Edit .env with production secrets

# 6. Deploy
docker compose up -d --build

# 7. Set up SSL (certbot + nginx)
apt install certbot -y
certbot --nginx -d api.yourdomain.com

# 8. Set up auto-renewal
echo "0 0 1 * * certbot renew --quiet" | crontab -
```

---

## Cost Summary

| Scenario | Monthly Cost | Users Supported |
|----------|-------------|-----------------|
| **Absolute minimum** (Hetzner CPX41, no managed DB) | **~$38** | Up to 5K |
| **Recommended** (Hetzner CCX23 + managed DB + Redis) | **~$77** | Up to 10K |
| **Comfortable** (Hetzner CCX33 + managed DB + Redis) | **~$117** | Up to 25K |
| **High availability** (2× CCX33 + LB + managed DB) | **~$196** | Up to 50K |

---

## TL;DR

> **Start with Hetzner CCX23 ($52/mo) + managed PostgreSQL ($15/mo) + managed Redis ($10/mo) = ~$77/mo.**
> This handles 10K users with dedicated CPU for pose verification, persistent WebSocket connections, and 99.95% uptime. Scale to CCX33 ($92/mo) when you hit 20K+ users.
