#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.server.yml"
SERVER_ENV="$ROOT/.env.server"
BACKEND_ENV="$ROOT/backend/.env"
STATE_DIR="$ROOT/.deploy"
CURRENT_RELEASE_FILE="$STATE_DIR/current-release"
BOOTSTRAP_ADMIN=0
VERIFY_PUBLIC=0
ADMIN_EMAIL=""
ADMIN_NAME="Platform Admin"

usage() {
  echo "Usage: bash deploy/server-install.sh [--bootstrap-admin] [--admin-email EMAIL] [--admin-name NAME] [--verify-public]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap-admin) BOOTSTRAP_ADMIN=1; shift ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --admin-name) ADMIN_NAME="${2:-}"; shift 2 ;;
    --verify-public) VERIFY_PUBLIC=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command in docker curl; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing command: $command" >&2; exit 1; }
done
docker compose version >/dev/null

for file in "$COMPOSE_FILE" "$SERVER_ENV" "$BACKEND_ENV"; do
  [[ -f "$file" ]] || { echo "Required file missing: $file" >&2; exit 1; }
done

if grep -Eqi 'REPLACE_WITH|USER:PASSWORD@HOST|change-me' "$SERVER_ENV" "$BACKEND_ENV"; then
  echo "Placeholder values remain in .env.server or backend/.env. Replace them before deployment." >&2
  exit 1
fi

env_value() {
  local file="$1" key="$2" value
  value="$(grep -m1 -E "^[[:space:]]*${key}=" "$file" | cut -d= -f2- | tr -d '\r' || true)"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

ROOT_REDIS_PASSWORD="$(env_value "$SERVER_ENV" REDIS_PASSWORD)"
BACKEND_REDIS_PASSWORD="$(env_value "$BACKEND_ENV" REDIS_PASSWORD)"
if [[ -z "$ROOT_REDIS_PASSWORD" || ${#ROOT_REDIS_PASSWORD} -lt 24 ]]; then
  echo "REDIS_PASSWORD in .env.server must be at least 24 characters." >&2
  exit 1
fi
if [[ "$ROOT_REDIS_PASSWORD" != "$BACKEND_REDIS_PASSWORD" ]]; then
  echo "REDIS_PASSWORD must match in .env.server and backend/.env." >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
PREVIOUS_RELEASE=""
[[ -f "$CURRENT_RELEASE_FILE" ]] && PREVIOUS_RELEASE="$(tr -d '\r\n' < "$CURRENT_RELEASE_FILE")"
RELEASE="v6-$(date -u +%Y%m%d%H%M%S)"
export IMAGE_TAG="$RELEASE"

compose() {
  docker compose --env-file "$SERVER_ENV" -f "$COMPOSE_FILE" "$@"
}

wait_for() {
  local label="$1" url="$2" attempts="${3:-30}"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 10 --output /dev/null "$url"; then
      echo "[PASS] $label"
      return 0
    fi
    sleep 2
  done
  echo "[FAIL] $label" >&2
  return 1
}

rollback() {
  if [[ -z "$PREVIOUS_RELEASE" ]]; then
    echo "No earlier image tag is recorded. Stopping the failed first release." >&2
    compose stop backend web marketing >/dev/null 2>&1 || true
    return 1
  fi
  echo "Rolling application containers back to $PREVIOUS_RELEASE ..." >&2
  export IMAGE_TAG="$PREVIOUS_RELEASE"
  compose up -d --no-build redis backend web marketing
  wait_for "rollback API readiness" "http://127.0.0.1:4100/v1/health/ready" 30
}

echo "Building immutable release $RELEASE ..."
compose --profile tools build migration admin-bootstrap backend web marketing

echo "Applying additive database migrations before application cutover ..."
compose --profile tools run --rm migration

echo "Starting release $RELEASE ..."
compose up -d --no-build redis backend web marketing

if ! wait_for "API readiness (PostgreSQL + Redis)" "http://127.0.0.1:4100/v1/health/ready" 40 \
  || ! wait_for "affiliate web" "http://127.0.0.1:3100" 20 \
  || ! wait_for "marketing web" "http://127.0.0.1:3002" 20; then
  rollback || true
  echo "Deployment health check failed. Previous application images were restored when available." >&2
  exit 1
fi

if [[ "$BOOTSTRAP_ADMIN" -eq 1 ]]; then
  [[ -n "$ADMIN_EMAIL" ]] || read -r -p "Super-admin email: " ADMIN_EMAIL
  read -r -s -p "New super-admin password: " ADMIN_PASSWORD
  echo
  export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
  if ! compose --profile tools run --rm -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD admin-bootstrap; then
    unset ADMIN_PASSWORD
    rollback || true
    echo "Admin bootstrap failed; release was not marked current." >&2
    exit 1
  fi
  unset ADMIN_PASSWORD
fi

if [[ "$VERIFY_PUBLIC" -eq 1 ]]; then
  if ! wait_for "public API" "https://affiliate.mentoringhub.online/v1/health/ready" 10 \
    || ! wait_for "public affiliate app" "https://affiliate.mentoringhub.online" 10 \
    || ! wait_for "public marketing site" "https://web.mentoringhub.online" 10; then
    rollback || true
    echo "Public Cloudflare verification failed; release was not marked current." >&2
    exit 1
  fi
fi

printf '%s\n' "$RELEASE" > "$CURRENT_RELEASE_FILE"
compose ps
echo "Deployment completed: $RELEASE"
echo "Previous image tag retained for rollback: ${PREVIOUS_RELEASE:-none}"
