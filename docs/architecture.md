# Architecture Overview

## System components

```
┌────────────────────────────────────────────────────────────────┐
│                         Browser / Mobile                             │
└─────────┬─────────┬─────────┬─────────┬──────────────────┘
         │         │         │         │
    Dashboard   Portal   Signup   Marketing
    (Next.js)  (Next.js) Embed   (Next.js)
         │         │         │         │
         └─────────┴─────────┴─────────┘
                         │
                  NestJS REST API
                  /v1/* (port 4000)
                    ┌────┴────┐
                    │           │
               PostgreSQL     Redis
               (primary DB)  (queues
                              + rate
                              limiting)
```

## Key design decisions

### Multi-tenancy
- Every tenant (organization) is isolated at the application layer via
  `TenantScopeMiddleware` (Prisma `$use` middleware).
- Database-level isolation uses PostgreSQL Row Level Security with
  `FORCE ROW LEVEL SECURITY` on all tenant tables.
- The `app.current_org_id` session variable is set before each query.

### Authentication
- Short-lived access tokens (JWT, 15 min) + rotating refresh tokens (7 days).
- Refresh tokens stored server-side (hashed) with reuse detection.
- Tokens delivered in `HttpOnly; Secure; SameSite=Strict` cookies.
- TOTP 2FA with recovery codes.
- OIDC SSO with per-tenant configuration and optional auto-provisioning.

### Authorization
- RBAC: roles with granular permission keys (`settings.write`, etc.).
- Every authenticated request re-fetches identity from DB (5s cache).
- Super-admin flag is separate from roles; all super-admin actions are
  written to the audit log.

### API keys
- Format: `aff_live_<random>` (prefix distinguishes live from test keys).
- Stored as HMAC-SHA256 hash; raw value shown once at creation only.
- Per-key scopes and optional expiry.

### Job queue
- BullMQ + Redis for webhook retry, email delivery, and async processing.
- Dead-letter queue for failed jobs with configurable max retries.

## Data flow: order ingest

```
Store (Shopify / WooCommerce)
  ↓ POST /v1/orders  (x-api-key)
OrdersController
  ↓ AttributionService.resolve()
    - Checks click/coupon windows
    - Determines winning affiliate
  ↓ CommissionService.create()
  ↓ WebhookService.fire() → BullMQ job
    - Delivers to tenant webhook endpoints with HMAC signature
    - Retries with exponential backoff
```
