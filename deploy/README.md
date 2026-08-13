# 10x Affiliate - Production Deployment (PM2 + Nginx + Cloudflare Tunnel)

Runs the whole platform on one VPS with **PM2** (process manager), **Nginx**
(reverse proxy) and **cloudflared** (Cloudflare Tunnel for public HTTPS on two
domains). No public ports are opened - Cloudflare reaches Nginx through the tunnel.

## Topology

```
  Internet (HTTPS)
        |
   Cloudflare edge  (TLS terminated here, free certs)
        |  (encrypted tunnel)
   cloudflared  --->  Nginx :80  (local origin, host-based routing)
        |                                       |
  10xaffiliate.com                     app.10xaffiliate.com
  www.10xaffiliate.com                        |
        |                          web :3000  +  /v1 -> api :4000
   marketing :3002
```

- **Domain 1** 10xaffiliate.com (+ www) -> marketing (PM2 affiliate-marketing, :3002)
- **Domain 2** app.10xaffiliate.com -> dashboard + portal (PM2 affiliate-web, :3000);
  API on the same domain under /v1 -> (PM2 affiliate-api, :4000)

> Replace the domains everywhere with your real ones: nginx/10x-affiliate.conf,
> cloudflared/config.yml, and the CORS_ORIGIN / NEXT_PUBLIC_API_URL env vars.

## 0. Prerequisites (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pm2
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

You also need PostgreSQL reachable via DATABASE_URL.

## 1. Environment

```bash
cd /var/www/affiliate-platform
cp backend/.env.example backend/.env
```

Set in backend/.env:

```
NODE_ENV=production
API_PORT=4000
DATABASE_URL=postgresql://user:pass@localhost:5432/affiliate
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
CORS_ORIGIN=https://app.10xaffiliate.com
SWAGGER_ENABLED=false
```

Frontends (build-time), in web/.env.production and marketing/.env.production:

```
NEXT_PUBLIC_API_URL=https://app.10xaffiliate.com/v1
```

> The API startup guard refuses to boot in production if DATABASE_URL,
> JWT_ACCESS_SECRET, JWT_REFRESH_SECRET or ENCRYPTION_KEY is missing.

## 2. Install, migrate, build

```bash
npm --prefix backend ci && npm --prefix web ci && npm --prefix marketing ci
npm --prefix backend run prisma:generate
npx --prefix backend prisma migrate deploy
npm --prefix backend run build
npm --prefix web run build
npm --prefix marketing run build
```

## 3. Start with PM2

```bash
mkdir -p logs
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup      # run the printed command to persist across reboots
pm2 status
```

## 4. Nginx

```bash
sudo cp deploy/nginx/10x-affiliate.conf /etc/nginx/sites-available/10x-affiliate.conf
sudo ln -s /etc/nginx/sites-available/10x-affiliate.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create 10x-affiliate
sudo mkdir -p /etc/cloudflared && sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
cloudflared tunnel route dns 10x-affiliate 10xaffiliate.com
cloudflared tunnel route dns 10x-affiliate www.10xaffiliate.com
cloudflared tunnel route dns 10x-affiliate app.10xaffiliate.com
sudo cp deploy/cloudflared/config.yml /etc/cloudflared/config.yml
# edit credentials-file -> the <UUID>.json path
sudo cloudflared service install
sudo systemctl restart cloudflared
```

## 6. Verify (run this to check for errors)

```bash
MARKETING_DOMAIN=10xaffiliate.com APP_DOMAIN=app.10xaffiliate.com bash deploy/verify.sh
```

Checks: (1) PM2 processes, (2) local ports incl. API /v1/health, (3) nginx -t +
service, (4) cloudflared service, (5) public HTTPS on both domains + API health.
Prints [PASS]/[FAIL] per check with a final tally and non-zero exit on failure.

## Common ops

```bash
pm2 logs                     # all logs
pm2 restart affiliate-api    # after a rebuild
pm2 reload all               # zero-downtime reload
sudo systemctl reload nginx
sudo systemctl restart cloudflared
```

## Redeploy after a change

```bash
git pull
npm --prefix backend run build && npm --prefix web run build && npm --prefix marketing run build
npx --prefix backend prisma migrate deploy
pm2 reload all
bash deploy/verify.sh
```
