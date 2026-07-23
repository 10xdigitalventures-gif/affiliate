#!/usr/bin/env bash
set -u

PUBLIC=0
[[ "${1:-}" == "--public" ]] && PUBLIC=1
failed=0

check() {
  local label="$1" url="$2" code
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 "$url" || true)"
  if [[ "$code" =~ ^(2|3)[0-9][0-9]$ ]]; then
    echo "[PASS] $label ($code)"
  else
    echo "[FAIL] $label (${code:-unreachable})" >&2
    failed=$((failed + 1))
  fi
}

check "API readiness" "http://127.0.0.1:4100/v1/health/ready"
check "Affiliate app" "http://127.0.0.1:3100"
check "Marketing site" "http://127.0.0.1:3002"

if [[ "$PUBLIC" -eq 1 ]]; then
  check "Public API" "https://affiliate.mentoringhub.online/v1/health/ready"
  check "Public affiliate app" "https://affiliate.mentoringhub.online"
  check "Public marketing site" "https://web.mentoringhub.online"
fi

[[ "$failed" -eq 0 ]] || exit 1
echo "All server checks passed."
