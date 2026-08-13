#!/usr/bin/env bash
# One-shot health check for the 10x Affiliate deployment.
# Run:  bash deploy/verify.sh
# Override:  MARKETING_DOMAIN=mysite.com APP_DOMAIN=app.mysite.com bash deploy/verify.sh
set -u

MARKETING_DOMAIN="${MARKETING_DOMAIN:-10xaffiliate.com}"
APP_DOMAIN="${APP_DOMAIN:-app.10xaffiliate.com}"
API_PREFIX="${API_PREFIX:-v1}"
HEALTH_PATH="${HEALTH_PATH:-$API_PREFIX/health}"

pass=0; fail=0
ok()  { echo "  [PASS] $1"; pass=$((pass+1)); }
bad() { echo "  [FAIL] $1"; fail=$((fail+1)); }

echo "== 1. PM2 processes =="
if command -v pm2 >/dev/null 2>&1; then
  L="$(pm2 jlist 2>/dev/null)"
  echo "$L" | grep -q 'affiliate-api'       && ok "affiliate-api registered"       || bad "affiliate-api missing"
  echo "$L" | grep -q 'affiliate-web'       && ok "affiliate-web registered"       || bad "affiliate-web missing"
  echo "$L" | grep -q 'affiliate-marketing' && ok "affiliate-marketing registered" || bad "affiliate-marketing missing"
else
  bad "pm2 not installed"
fi

echo "== 2. Local app ports =="
curl -fsS -o /dev/null "http://127.0.0.1:4000/$HEALTH_PATH" && ok "API :4000 /$HEALTH_PATH" || bad "API :4000 health failed (set HEALTH_PATH if route differs)"
curl -fsS -o /dev/null "http://127.0.0.1:3000"             && ok "web :3000 responding"      || bad "web :3000 not responding"
curl -fsS -o /dev/null "http://127.0.0.1:3002"             && ok "marketing :3002 responding" || bad "marketing :3002 not responding"

echo "== 3. Nginx =="
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t >/dev/null 2>&1 && ok "nginx config valid" || bad "nginx -t failed"
  systemctl is-active --quiet nginx 2>/dev/null && ok "nginx active" || bad "nginx not active"
else
  bad "nginx not installed"
fi

echo "== 4. cloudflared =="
if command -v cloudflared >/dev/null 2>&1; then
  systemctl is-active --quiet cloudflared 2>/dev/null && ok "cloudflared active" || bad "cloudflared not active"
else
  bad "cloudflared not installed"
fi

echo "== 5. Public URLs (through Cloudflare) =="
curl -fsS -o /dev/null "https://$MARKETING_DOMAIN"         && ok "marketing domain reachable"   || bad "marketing domain not reachable"
curl -fsS -o /dev/null "https://$APP_DOMAIN"              && ok "app domain reachable"        || bad "app domain not reachable"
curl -fsS -o /dev/null "https://$APP_DOMAIN/$HEALTH_PATH" && ok "public API health reachable" || bad "public API health failed"

echo ""
echo "== RESULT: $pass passed, $fail failed =="
if [ "$fail" -eq 0 ]; then echo "All checks passed."; else echo "Fix the [FAIL] items above, then re-run."; exit 1; fi
