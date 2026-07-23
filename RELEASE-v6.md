# Affiliate Platform enterprise v6

## Deployment incident fixed

The v5 replacement attempted to rename the live project root. Windows correctly
blocked that operation while the calling PowerShell prompt was inside
`E:\Programs\Affiliate-Platform-Live\backend`. v6 never renames the live root:
it builds outside the tree, backs up and cuts over with content mirrors, and can
therefore deploy while directory handles remain open.

The earlier `npm run build` / missing `dist\main.js` issue had a separate root
cause: Nest deleted `dist`, while a stale TypeScript incremental cache emitted
only recently changed files. Production builds now disable incremental output
and the deployer checks a multi-file backend artifact manifest.

## Product completion

- Required login with rotating Secure/HttpOnly cookies, logout and forgot/reset
  password flows.
- Right-aligned account dropdown with profile settings and logout.
- Editable name, email (current-password protected), phone and profile image.
- Platform super-admin, isolated tenant dashboard and private affiliate portal.
- Team page with invitations, custom RBAC roles, live permission invalidation,
  member suspension/reactivation, seat limits and audit logs.
- Workspace-aware login for an email used in more than one organization.
- Secure OIDC SSO, 2FA, API keys and Shopify staff identity binding.
- Shopify embedded sessions use host-only, HttpOnly, Secure, partitioned cookies;
  browser storage never receives access or refresh tokens.
- Account deletion requires the current password plus an explicit confirmation,
  records the event, and blocks deletion of the last platform super-admin.

## Financial and billing integrity

- Append-only affiliate ledger and per-currency balances.
- Idempotent commission generation, cumulative refunds/reversals and payout
  reservation/settlement with transactional concurrency controls.
- Subscription billing locks, deterministic invoice keys, retry-safe provider
  requests, fixed past-due grace windows and verified replay-safe webhooks.
- Whop request/signature behavior aligned with its documented API; unverified
  Swich endpoints fail closed until explicitly configured from a merchant
  contract.

## Security and operations

- Additive tenant-consistency/immutability database triggers.
- Database-enforced tenant/store coupon uniqueness with a deterministic cleanup
  migration for legacy duplicates.
- Production startup rejects missing, short, placeholder, reused secrets and
  wildcard CORS.
- Runtime JWT authorization reloads current roles and account/workspace status.
- Readiness verifies both PostgreSQL and Redis and returns HTTP 503 if degraded.
- Request IDs are length/character constrained before entering logs.
- Public DTOs cap identifiers, URLs, arrays, money and provider payloads; unsafe
  normalized catalog rows are rejected instead of entering the database.
- OIDC and payout-provider calls require production HTTPS, have bounded response
  bodies and deadlines, and do not copy provider responses into logs/errors.
- Referral codes are canonicalized and tenant-scoped; an ambiguous code fails
  closed instead of attributing a click to an arbitrary organization.
- Backend, web and marketing production dependency audits report zero known
  vulnerabilities at release time.
- Cloudflared updates preserve the existing tunnel configuration.
- Final Linux flow uses tagged, non-root, immutable Docker images with app-image
  rollback and a dedicated tunnel while retaining the old JIL deployment.

## Verification baseline

- Backend build manifest present (`dist/main.js` and required modules).
- Backend automated tests: 228 passing across 29 suites.
- Dashboard/app production build: 47 routes, standalone artifact generated.
- Marketing production build: 9 routes, standalone artifact generated.
- Backend/web/marketing TypeScript checks pass.
- Prisma schema validation and client generation pass.
- Shell deploy scripts, browser tracker, PM2 manifest and Next configuration
  parse cleanly; the Windows deploy performs clean builds and post-cutover
  local/public/security checks before reporting success.
