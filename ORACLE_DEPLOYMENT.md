# Kinetik on Oracle Cloud Always Free

> **Scope:** deploying `api-core`, `realtime`, and `nginx` to a single Oracle Ampere A1 instance.
> **Account type:** non-upgraded **Free Tier** — Oracle cannot bill you. If you try to exceed an
> Always Free limit the console refuses to create the resource instead of charging for it.
> **Assumes:** PostgreSQL (Layerbase) and Redis (Aiven / Layerbase) stay hosted where they are.

Cost: **$0/mo**, plus a domain if you want a nice URL (§6).

---

## 1. What you get, and what actually fits

Always Free ARM allowance: **4 OCPU + 24 GB RAM**, 200 GB block storage, 10 TB/month egress.
Take it all in **one instance** — there's no benefit to splitting it.

| Container | Memory | |
|---|---|---|
| `api-core` | 256 MB | Fastify REST API, port 3001 |
| `realtime` | 256 MB | Socket.IO, port 3002 |
| `nginx` | 64 MB | Reverse proxy + TLS, ports 80/443 |
| **Total** | **~576 MB** | **out of 24 GB** |

You will use roughly 3% of the machine. No swap needed, and unlike a 1 GB VPS you can build
both images at once without any risk of an out-of-memory kill.

> **ARM is fine.** The images are `node:20-alpine` and `nginx:alpine`, both multi-arch, and the
> two native modules — `bcrypt` and `sharp` — ship working `linuxmusl-arm64` binaries. Verified:
> both install and load on `aarch64` Alpine with no build tools and no Dockerfile changes.

---

## 2. Create the instance

1. **Pick your home region carefully at signup.** It is fixed permanently, and Always Free
   resources only exist there. Choose the one nearest your users *and* your Layerbase/Aiven
   regions — every API call makes a database round trip.
2. Compute → **Create instance**.
3. **Image:** Ubuntu 24.04 (Canonical). **Shape:** change it → **Ampere** →
   `VM.Standard.A1.Flex` → **4 OCPUs, 24 GB memory**. Confirm it says **Always Free Eligible**.
4. Boot volume: the default (~50 GB) is fine — you have 200 GB of allowance.
5. Add your SSH **public** key. There is no password login.
6. Create.

### When it says "Out of host capacity"

This is normal, not a mistake you made. ARM capacity in popular regions is genuinely scarce.

- Try each **availability domain** in the dropdown (AD-1, AD-2, AD-3) — they have separate pools.
- Try again at a different hour. Capacity frees up unpredictably.
- Ask for **less**: 2 OCPU / 12 GB often succeeds where 4 / 24 fails, and is still 15× what
  this stack needs. You can't resize an A1 later, but you can destroy and recreate.

---

## 3. The two-firewall trap ⚠️

**This is the single biggest Oracle gotcha.** There are *two* independent firewalls, and
opening only the first one — the obvious one, in the console — leaves your ports still closed.
People lose hours here.

### 3a. The cloud firewall (VCN Security List)

Networking → your VCN → **Security Lists** → default list → **Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

Do **not** open 3001, 3002 or 9000. Everything reaches the services through nginx.

### 3b. The host firewall (iptables on the instance)

Oracle's Ubuntu images ship with iptables rules that drop everything except SSH. The cloud rule
above does nothing until you also do this:

```bash
# See what's there — note the line number of the final REJECT rule
sudo iptables -L INPUT --line-numbers

# Insert ACCEPT rules ABOVE that REJECT (adjust 6 to match your listing)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT

# Persist across reboots — without this you'll redo it after every restart
sudo netfilter-persistent save
```

> On an **Oracle Linux** image it's firewalld instead:
> `sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp && sudo firewall-cmd --reload`

Sanity check from your laptop before going further — `curl -v http://<public-ip>` should
*connect* (a 404 from nginx later is fine; connection refused or a hang means a firewall is
still shut).

---

## 4. Prepare the host

```bash
ssh ubuntu@<public-ip>

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu && newgrp docker
sudo apt update && sudo apt install -y git unattended-upgrades
```

No swap step. You have 24 GB.

---

## 5. Deploy

```bash
git clone <your-repo> kinetik && cd kinetik
cp .env.example .env
nano .env                     # see §7

docker compose build api-core realtime
docker compose up -d
docker compose logs -f migration-runner   # ends with "Migration run complete"
```

`api-core` and `realtime` are gated on `migration-runner` finishing successfully, so a schema
failure stops the stack cleanly instead of leaving it half-running. `restart: unless-stopped`
plus Docker's systemd unit brings everything back after a reboot — no service file needed.

Check: `docker compose ps` should show `api-core`, `realtime`, `nginx`, `minio`, `minio-init`
(if you kept MinIO) and a **exited (0)** `migration-runner`.

---

## 6. TLS

Android blocks cleartext HTTP by default, so the API **must** be HTTPS — not optional polish.
Let's Encrypt will not issue for a bare IP, so you need a hostname:

- **A domain** (~$10/yr) — `A` record → the instance's public IP. The clean answer.
- **Free** — DuckDNS or No-IP. Let's Encrypt issues for these normally.

```bash
sudo apt install -y certbot
docker compose stop nginx
sudo certbot certonly --standalone -d api.yourdomain.com
docker compose start nginx
```

Then in `docker-compose.yml`, add to the `nginx` service:

```yaml
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

And in `config/nginx.conf`, replace `server { listen 80; server_name _; ... }` with a redirect
plus a TLS block. **The existing `location` blocks move across unchanged** — `/socket.io/`,
`/api/v1/auth/`, `/api/`, `/health`:

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

    # ... existing location blocks, copied verbatim ...
}
```

> Keep `proxy_read_timeout 86400s` and `proxy_buffering off` on `/socket.io/`. Those are what
> hold WebSockets open through the proxy — drop them and chat dies after 60 seconds.

Auto-renewal:

```bash
echo '0 3 * * * root certbot renew --quiet --deploy-hook "docker restart kinetik-nginx"' \
  | sudo tee /etc/cron.d/certbot-renew
```

Reload nginx after editing the config: `docker compose restart nginx`.

---

## 7. Environment variables

Start from `FREE_HOSTING_GUIDE.md` §12, then override for production:

```
NODE_ENV=production
JWT_SECRET=<long random string>              # byte-identical in both services
MESSAGE_ENCRYPTION_KEY=<random 32+ chars>    # changing it makes old messages unreadable
PAYMENT_WEBHOOK_SECRET=<from your PSP>
```

⚠️ `docker-compose.yml` ships development fallbacks for `JWT_SECRET` and
`MESSAGE_ENCRYPTION_KEY`. Anyone who reads this repo can mint valid tokens against a server
still using them. Set both explicitly.

Confirm `DATABASE_URL` ends with `?sslmode=require` and `POSTGRES_SSLMODE=require` is set, so
`migration-runner` connects over TLS.

**Photos:** keep them on Cloudflare R2 (`FREE_HOSTING_GUIDE.md` §5) and don't run the `minio`
container — then delete the `/uploads/` block from `config/nginx.conf`, since R2 hands out
absolute URLs and nginx is never in that path. Oracle's 10 TB egress is generous enough that
self-hosting MinIO here is *viable* (unlike on AWS), but R2 is still less to run.

---

## 8. Point the mobile app at it

`packages/mobile/app.json` → `expo.extra`:

```json
"extra": {
  "apiUrl": "https://api.yourdomain.com",
  "wsUrl":  "https://api.yourdomain.com"
}
```

Both are the same host — nginx routes `/socket.io/` to `realtime` and `/api/` to `api-core`.
Rebuild the app; these are read at build time.

---

## 9. Free-tier specifics

**Billing:** on a non-upgraded Free Tier account there is no authorized payment method. Exceeding
an Always Free limit produces a "requires an upgrade" refusal, not a charge. The card at signup
is identity verification only.

**Idle reclamation:** Oracle may reclaim Always Free compute that sits at very low CPU, network
and memory for about a week. A live app with real users and UptimeRobot pings every 5 minutes is
not idle, so this shouldn't bite — but it's the reason not to spin this up and leave it empty for
a month. Upgrading to Pay-As-You-Go exempts you (Always Free resources stay free), at the cost of
making overage charges possible.

**Monitoring** — UptimeRobot, free, 5-minute checks. These double as the anti-idle traffic:
- `https://api.yourdomain.com/health`
- `https://api.yourdomain.com/socket.io/?EIO=4&transport=polling`

**Backups:** boot-volume backups are inside the free allowance — enable them. They don't cover
the database. Layerbase free tiers have no restore, so a GitHub Actions cron running `pg_dump`
into R2 is what stands between you and a bad afternoon.

---

## 10. Gotchas

1. **Two firewalls (§3).** Opening the console Security List alone is not enough. This is the
   most common Oracle failure by a wide margin.
2. **Persist iptables** with `netfilter-persistent save`, or your ports close on reboot.
3. **The home region is permanent.** Chosen at signup, and Always Free resources live only there.
4. **"Out of host capacity" is expected** (§2). Try other ADs, other times, or ask for 2 OCPU.
5. **Let's Encrypt won't certify an IP.** Sort the hostname out before launch day.
6. **`ip_hash` in the `realtime_cluster` upstream is load-bearing** if you ever run a second
   instance while Socket.IO polling is enabled. On one box it's a no-op.
7. **Rate limits are per-nginx.** `auth_limit` at 5r/m silently becomes 10r/m with two proxies.
8. **Don't let the instance idle for weeks** (§9).

---

## 11. Later: consolidate onto this box

With 24 GB you could stop paying rent to anyone. `docker-compose.yml` still contains the
commented-out `postgres`, `redis`, `redis-events` and `livekit` services — uncomment them, move
`DATABASE_URL` and the Redis variables back to local hostnames, and the whole stack runs on one
machine with no external dependencies and no cross-region latency on every query.

Worth it once the app is stable. Not worth doing during the initial deploy, when you want the
smallest possible number of things that can go wrong at once — and note you'd then own backups,
upgrades and tuning for Postgres yourself, which Layerbase currently handles.

---

## 12. Checklist

- [ ] Home region chosen near users + Layerbase/Aiven
- [ ] A1.Flex instance created, "Always Free Eligible" confirmed, SSH key added
- [ ] **VCN Security List:** ingress 80 + 443
- [ ] **Host iptables:** 80 + 443 accepted **and** `netfilter-persistent save` run
- [ ] `curl http://<public-ip>` connects from outside
- [ ] Docker installed · repo cloned · `.env` filled with real secrets
- [ ] `docker compose up -d` · `migration-runner` exited 0
- [ ] Hostname → public IP · certbot cert · 443 exposed · TLS block · renewal cron
- [ ] `MINIO_*` → R2 · `/uploads/` block removed from nginx.conf
- [ ] Mobile `apiUrl` / `wsUrl` updated · app rebuilt
- [ ] UptimeRobot monitors · boot-volume backups · database `pg_dump` cron
- [ ] End-to-end: signup → onboarding → photo upload → like → match → chat
