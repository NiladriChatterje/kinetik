# Kinetik on AWS — Least-Cost Deployment

> **Scope:** `api-core`, `realtime`, and `nginx` only.
> **Assumes:** PostgreSQL (Layerbase) and Redis (Aiven / Layerbase) are already hosted
> elsewhere and stay there — see `FREE_HOSTING_GUIDE.md`. Nothing here provisions a database.
> **Goal:** the cheapest AWS setup that still terminates TLS and holds WebSockets open.

For the 10,000-user, multi-server sizing exercise see `DEPLOYMENT_SERVERS.md`. This document
is the opposite end: one small box, three containers, the smallest bill AWS will accept.

---

## 1. The verdict

| Option | Indicative $/mo | Verdict |
|---|---|---|
| **Lightsail 2 GB** | **~$10** | ✅ **Recommended.** Flat price, public IP and 3 TB transfer included |
| Lightsail 1 GB | ~$5 | ⚠️ Works, but only with swap and a pre-built image (§4) |
| EC2 `t4g.micro` + EBS + IPv4 | ~$10–11 | Same money as Lightsail 2 GB, more moving parts, metered egress |
| EC2 `t4g.small` + EBS + IPv4 | ~$17 | Only if you want reserved-instance discounts later |
| ECS Fargate (3 tasks) | ~$27+ | ❌ Three always-on tasks at 0.25 vCPU each |
| App Runner / Elastic Beanstalk + ALB | ~$35+ | ❌ The load balancer alone costs more than the server |

> Prices are indicative us-east-1 figures and AWS changes them. Check the console before
> committing — the *ranking* is stable, the exact numbers are not.

**Lightsail wins because of what it bundles.** On EC2 you pay separately for the instance,
the EBS volume, and — since 2024 — **every public IPv4 address at ~$0.005/hr (~$3.65/mo),
even while attached to a running instance**. Lightsail folds the IP, the disk, and a
multi-terabyte transfer allowance into one flat number.

---

## 2. The four traps that cost more than your server

Read this section even if you skip the rest. Each of these is a default-looking choice that
quietly multiplies the bill.

| Trap | Real cost | Do this instead |
|---|---|---|
| **Application Load Balancer** | ~$16/mo *before* traffic | You already have nginx. Terminate TLS on the box (§7) |
| **NAT Gateway** | ~$32/mo + $0.045/GB | Put the instance in a **public** subnet. It needs no NAT |
| **S3 for photos** | $0.09/GB egress — unbounded | Keep photos on **Cloudflare R2** (zero egress) |
| **CloudWatch Logs agent** | Per-GB ingest, grows silently | The stack already rotates logs locally (`x-logging` in compose) |

The S3 one deserves emphasis for this app specifically. Kinetik is photo-heavy: every feed
scroll pulls profile images. On S3 that egress is billed per gigabyte forever, with no cap.
R2 charges nothing for downloads, which is why `MINIO_PUBLIC_URL` already points there in the
free-hosting setup. **Moving photos to S3 is the single easiest way to turn a $10 bill into a
$60 one.** Leave them on R2 and let AWS carry only JSON and WebSocket frames.

---

## 3. What actually runs on the box

With Postgres and Redis remote, only three containers stay up:

| Container | Memory limit (compose) | Notes |
|---|---|---|
| `api-core` | 256 MB | Fastify REST API, port 3001 |
| `realtime` | 256 MB | Socket.IO, port 3002, long-lived connections |
| `nginx` | 64 MB | Reverse proxy + TLS, ports 80/443 |
| `migration-runner` | — | One-shot, exits immediately after migrating |
| **Total** | **~576 MB** | Plus ~200 MB for Ubuntu and the Docker daemon |

`postgres`, `redis`, `redis-events`, `livekit`, and `pose-service` are already commented out
in `docker-compose.yml` — leave them that way. `minio` is the one judgement call: see §6.

~776 MB of steady-state usage fits a 1 GB box **at runtime**. Building is the problem, not
running — see the next section.

---

## 4. Why 1 GB hurts (and how to survive it)

`docker compose build` runs `npm install` plus `tsc` for the shared package and both
services. On a 1 GB instance that reliably thrashes or gets OOM-killed partway through, and
the failure looks like an unrelated npm error, which wastes an afternoon.

Three ways out, cheapest effort first:

1. **Use the 2 GB plan.** Five dollars more, no workarounds. This is the recommendation.
2. **Add swap** (do this regardless — see §5) and build **one service at a time**:
   ```bash
   docker compose build api-core
   docker compose build realtime
   ```
3. **Build elsewhere, pull on the box.** Build locally or in GitHub Actions, push to Docker
   Hub or ECR, and have the server only `docker compose pull`. Best for repeat deploys, and
   it makes the 1 GB plan genuinely comfortable.

---

## 5. Provision the instance

1. Lightsail console → **Create instance** → Linux/Unix → **OS Only → Ubuntu 24.04 LTS**.
2. Pick the region closest to your users *and* close to your Layerbase/Aiven regions —
   every request makes a database round trip, so cross-region latency is charged to every
   API call you serve.
3. Choose the **2 GB / 2 vCPU** plan (§1).
4. Create → **Networking → Attach static IP** (free while attached to a running instance).
5. **Networking → IPv4 Firewall** — allow exactly:

   | Application | Protocol | Port |
   |---|---|---|
   | SSH | TCP | 22 |
   | HTTP | TCP | 80 |
   | HTTPS | TCP | 443 |

   Do **not** open 3001, 3002, or 9000. Everything reaches the services through nginx.

Then SSH in and prepare the host:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu && newgrp docker

# Swap — cheap insurance against build-time OOM, and it costs nothing
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Unattended security updates
sudo apt update && sudo apt install -y unattended-upgrades
```

---

## 6. Photos: R2, or MinIO on the box?

**Default: keep R2.** Set `MINIO_*` to the R2 values from `FREE_HOSTING_GUIDE.md` §5, do not
run the `minio` container, and **delete the `/uploads/` location block** from `config/nginx.conf`
— with R2 the app hands out absolute `https://pub-<hash>.r2.dev/...` URLs and nginx is never
in the path.

**If you insist on MinIO on the instance:** uncomment `minio` and `minio-init`, budget another
512 MB (so take the 4 GB plan), keep the `/uploads/` block pointing at `minio:9000`, and accept
that every photo view is now billed AWS egress. Only worth it if you are deliberately avoiding
a second vendor.

---

## 7. TLS, and the domain problem

Modern Android blocks cleartext HTTP by default, so **the API must be HTTPS** — this is not
optional polish. Let's Encrypt will not issue a certificate for a bare IP address, so you need
a hostname.

- **Have a domain?** Point an `A` record at the static IP. ~$10/year, the clean answer.
- **Don't?** Use a free dynamic-DNS hostname (DuckDNS, No-IP). Let's Encrypt issues for these
  normally. Ugly URL, real certificate.

Get the certificate on the host, then let nginx read it:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d api.yourdomain.com   # stop nginx first, or use --webroot
```

Mount the certs into the nginx container by adding to its `volumes:` in `docker-compose.yml`:

```yaml
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

…expose 443 (`- "443:443"`), and add a TLS server block to `config/nginx.conf`. The existing
`server { listen 80; ... }` body — `/socket.io/`, `/api/v1/auth/`, `/api/`, `/health` — moves
into it unchanged:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    client_max_body_size 10M;

    # ... existing location blocks, unchanged ...
}
```

Auto-renewal. `--standalone` needs port 80 to itself and the nginx container
publishes it, so nginx must be stopped for the renewal and restarted after —
a `--deploy-hook` alone never runs, because renewal fails first:

```bash
echo '0 3 * * * root certbot renew --quiet --pre-hook "docker stop kinetik-nginx" --post-hook "docker start kinetik-nginx"' \
  | sudo tee /etc/cron.d/certbot-renew
```

Verify with `sudo certbot renew --dry-run --pre-hook "docker stop kinetik-nginx" --post-hook "docker start kinetik-nginx"`.

> The `proxy_read_timeout 86400s` and `proxy_buffering off` already set on `/socket.io/` are
> what keep Socket.IO alive through the proxy. Don't drop them when you move the block.

---

## 8. Deploy

```bash
git clone <your-repo> kinetik && cd kinetik
cp .env.example .env && nano .env        # §9
docker compose build api-core realtime   # one at a time on a small box
docker compose up -d
docker compose logs -f migration-runner  # should end with "Migration run complete"
```

`api-core` and `realtime` are gated on `migration-runner` completing successfully, so if the
schema step fails they never start and you get a clean error instead of a half-running stack.

`restart: unless-stopped` plus Docker's own systemd unit means the stack comes back after a
reboot on its own. No extra service file needed.

---

## 9. Production environment variables

Beyond the `FREE_HOSTING_GUIDE.md` §12 list, change these for a public deployment:

```
NODE_ENV=production
JWT_SECRET=<long random string>              # must be byte-identical in both services
MESSAGE_ENCRYPTION_KEY=<random 32+ chars>    # changing it makes existing messages unreadable
GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=/run/secrets/play-service-account.json
GOOGLE_PLAY_RTDN_SECRET=<openssl rand -hex 32>
```

⚠️ `docker-compose.yml` ships development fallbacks for `JWT_SECRET` and
`MESSAGE_ENCRYPTION_KEY`. They are convenient locally and dangerous in public — anyone reading
this repo can mint valid tokens against a server still using them. Set both explicitly.

Also confirm `DATABASE_URL` carries `?sslmode=require` and that `POSTGRES_SSLMODE=require` is
set, so `migration-runner` connects over TLS.

---

## 10. Point the mobile app at it

`packages/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "apiUrl": "https://api.yourdomain.com",
  "wsUrl":  "https://api.yourdomain.com"
}
```

Both point at the same host — nginx routes `/socket.io/` to `realtime` and `/api/` to
`api-core`. Rebuild the app afterwards; these are read at build time.

---

## 11. Backups and monitoring

- **Lightsail snapshots** — enable automatic snapshots (~$0.05/GB-month, so a few cents here).
  They cover the box, not the database.
- **Database backups are your job.** Layerbase free tiers have no restore. A GitHub Actions
  cron running `pg_dump` into R2 costs nothing and is the difference between an incident and
  a catastrophe.
- **Uptime** — UptimeRobot, free, 5-minute checks:
  - `https://api.yourdomain.com/health`
  - `https://api.yourdomain.com/socket.io/?EIO=4&transport=polling`

---

## 12. Cost summary

| Item | $/mo |
|---|---|
| Lightsail 2 GB (instance, static IP, 3 TB transfer, disk) | ~$10 |
| Automatic snapshots | ~$0.20 |
| PostgreSQL (Layerbase) | $0 |
| Redis (Aiven / Layerbase) | $0 |
| Photos (Cloudflare R2) | $0 |
| Domain | ~$1 (~$10/yr), or $0 on DuckDNS |
| **Total** | **~$11/mo** |

Every AWS-native alternative — ALB, Fargate, RDS, ElastiCache, S3 egress — adds more than the
entire bill above. Reach for them when traffic demands it, not before.

---

## 13. Gotchas

1. **Public IPv4 is billed on EC2, bundled on Lightsail.** This alone is most of the gap
   between the two options at small scale.
2. **Never add a NAT Gateway.** It is ~$32/mo and a single public-subnet instance has no use
   for one. It appears by default in a lot of VPC wizards.
3. **Building on 1 GB fails confusingly** (§4). Swap first, or build off-box.
4. **`ip_hash` in the `realtime_cluster` upstream is load-bearing** while Socket.IO polling is
   enabled. On one instance it is a no-op — but if you ever add a second, do not remove it
   without switching the client to WebSocket-only transport.
5. **Let's Encrypt will not certify an IP address.** Sort the hostname out before you plan the
   launch, not during it.
6. **Rate limits are per-nginx-instance.** `auth_limit` at 5r/m is fine behind one proxy; it
   silently becomes 10r/m the day you run two.
7. **Keep the instance in the same region as Layerbase and Aiven.** Cross-region adds tens of
   milliseconds to *every* database and cache call, which is far more noticeable than any CPU
   difference between these instance sizes.

---

## 14. Checklist

- [ ] Lightsail 2 GB, Ubuntu 24.04, region matched to Layerbase/Aiven
- [ ] Static IP attached · firewall limited to 22 / 80 / 443
- [ ] Docker installed · 2 GB swap added
- [ ] Hostname resolving to the static IP
- [ ] `.env` filled — real `JWT_SECRET` and `MESSAGE_ENCRYPTION_KEY`, `sslmode=require`
- [ ] `MINIO_*` pointing at R2 · `/uploads/` block removed from `config/nginx.conf`
- [ ] Certbot certificate issued · 443 exposed · TLS server block added · renewal cron
- [ ] `docker compose up -d` · `migration-runner` logs end with "Migration run complete"
- [ ] Mobile `apiUrl` / `wsUrl` updated and app rebuilt
- [ ] UptimeRobot monitors · Lightsail snapshots · database `pg_dump` cron
- [ ] End-to-end: signup → onboarding → photo upload → like → match → chat
