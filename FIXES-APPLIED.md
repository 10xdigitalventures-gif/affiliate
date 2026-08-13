# Fixes applied — C1, C2(a), C3, H1

> **Status: NOT verified by a build or test run.** The sandbox these patches were
> written in has no network and no `node_modules`, so `npm ci`, `prisma generate`,
> `npm run build` and `npm test` could not be executed. Every file below was only
> checked with standalone `tsc --noEmit --skipLibCheck --noResolve` syntax
> checking. Treat this as a reviewable patch set, not as tested code.

## Run this first

```bash
cd backend && npm ci && npx prisma generate && npm run build && npm test
cd ../web && npm ci && npm run build
```

`npx prisma generate` is required before `tsc` can type-check the new Prisma
calls. `mode: 'insensitive'` needs the PostgreSQL provider (this project uses it).

---

## C1 — Login was not tenant-aware

`User` has `@@unique([organizationId, email])` and **no** global unique on
`email`, so the same address can legitimately exist in several workspaces. The
old login did `findFirst({ where: { email } })`, which silently picked an
arbitrary tenant's account.

Login is now tenant-first: the workspace is resolved from an explicit `orgSlug`,
a verified custom login domain, or a subdomain. If the email matches accounts in
more than one workspace, the API returns a short-lived challenge and the user
picks a workspace instead of being logged into a random one. Password reset is
scoped the same way and sends one labelled link per workspace.

**New**
- `backend/src/common/tenant/tenant-resolver.service.ts`
- `backend/src/common/tenant/tenant.module.ts`

**Modified**
- `backend/src/auth/auth.service.ts` — `findAccountsByEmail`, `verifyCredentials`,
  `assertLoginable`, tenant-aware `validateUser`, `login`, `selectWorkspace`,
  `completeLogin`, tenant-scoped `forgotPassword`
- `backend/src/auth/auth.controller.ts` — `POST /auth/select-workspace` (throttled 10/min), `hostname` in client context
- `backend/src/auth/auth.module.ts`, `backend/src/auth/dto/login.dto.ts`, `backend/src/auth/dto/auth.dto.ts`
- `backend/src/auth/auth.service.spec.ts` — rewired stubs + 11 new regression tests
- `web/app/login/page.tsx` — "Choose a workspace" step
- `backend/.env.example` — `TENANT_ROOT_DOMAINS`

**Action required:** set `TENANT_ROOT_DOMAINS` in production or subdomain
resolution stays off. Leaving it empty is fine if every merchant uses a custom
login domain.

---

## C2(a) — No query-level tenant isolation

Application-layer scoping: an `AsyncLocalStorage` tenant context plus a Prisma
middleware that narrows every query to the active organization.

**Key schema finding:** `Order`, `OrderItem` and `Commission` have **no
`organizationId` column**. A blanket filter would break them, so the middleware
uses a per-model strategy map:

| Kind | Models | Filter |
|---|---|---|
| `root` | `Organization` | `{ id }` |
| `direct` | 37 models | `{ organizationId }` |
| `relation` | `Order`, `OrderItem`, `Commission` | via parent, e.g. `{ store: { organizationId } }` |
| `global` | `Permission`, `RolePermission`, `GatewayEvent` | none |

Wired with `$use`, **not** `$extends`, on purpose: `$extends` returns a *new*
client, which would have meant re-pointing all ~429 existing `this.prisma.*`
call sites, with any missed one silently staying unscoped.

`TENANT_SCOPE_MODE=off|warn|enforce` (default `warn`) allows a staged rollout —
`warn` logs every unscoped query with model and operation so the remaining call
sites can be found from real traffic before `enforce` starts throwing.

A startup self-check enumerates Prisma's DMMF and throws if any model is
unclassified, so a newly added table cannot quietly become cross-tenant.

**New**
- `backend/src/prisma/tenant-context.ts`
- `backend/src/prisma/tenant-scope.ts`
- `backend/src/prisma/tenant-scope.spec.ts` — 26 tests
- `backend/src/common/interceptors/tenant-context.interceptor.ts`

**Modified**
- `backend/src/prisma/prisma.service.ts`, `backend/src/app.module.ts`
- `backend/src/auth/auth.service.ts` — pre-tenant lookups wrapped in `runUnscoped(reason)`
- `backend/.env.example` — `TENANT_SCOPE_MODE`

**Known limits**
- `$queryRaw` / `$executeRaw` bypass this layer entirely. Closing that gap is
  what C2(b) database RLS is for.
- `create` on `Order` / `OrderItem` / `Commission` cannot be auto-scoped, because
  the tenant lives on a parent row.
- **Open decision:** add `organizationId` to those three tables (migration +
  backfill) or keep relation-path scoping. The strategy map supports both, but
  denormalising is effectively a prerequisite for clean RLS, otherwise policies
  on `Order` need a join on every row.

---

## C3 — API keys accepted in the query string

Query strings land in access logs, proxy logs, browser history and `Referer`
headers. The guard is now header-only (`x-api-key`).

Verified this is not a breaking change: the WooCommerce plugin, the dashboard
curl examples, the Swagger definition and `test/auth.e2e-spec.ts` all already
send the header. Callers still using `?apiKey=` now get a specific 401 telling
them to switch and to revoke the exposed key, plus a server-side warning.

**New**
- `backend/src/common/guards/apikey.guard.spec.ts` — 9 tests

**Modified**
- `backend/src/common/guards/apikey.guard.ts`
- `backend/src/observability/sentry.ts` — redacts `apiKey`, `api_key`, `token`,
  `access_token`, `refresh_token` from both `query_string` and `url`

---

## H1 — JWT claims were trusted without verification

`validate(payload) { return payload }` meant every authorization decision
trusted a snapshot taken at login. A suspended user, a revoked role or a
suspended organization stayed fully effective until the token expired (900s).

This mattered more after C2(a), because the tenant interceptor keys off
`req.user.organizationId`.

The token now supplies only `sub`. `IdentityService` rebuilds `organizationId`,
`permissions`, `affiliateId` and `isSuperAdmin` from the database per request,
and rejects: suspended users, `invited` users, suspended organizations, deleted
users, and any token whose `organizationId` does not match the account record.

**Tradeoff, stated plainly:** `AUTH_IDENTITY_CACHE_MS` (default 5000, 0 disables)
caches the lookup so this is not a database read on all ~287 authenticated call
sites. That TTL is also the longest window a revoked permission can still be
honoured. 900s down to 5s is a large improvement, but it is not zero.

No breakage: the 30 files importing `JwtPayload` as the `req.user` type remain
assignable.

**New**
- `backend/src/auth/identity.service.ts`
- `backend/src/auth/jwt.strategy.spec.ts` — 14 tests

**Modified**
- `backend/src/auth/jwt.strategy.ts`, `backend/src/auth/auth.module.ts`
- `backend/src/superadmin/superadmin.guard.ts` — comment only
- `backend/.env.example` — `AUTH_IDENTITY_CACHE_MS`

**Follow-up:** inject `IdentityService` into `AuthService` to invalidate the
cache immediately on password / role / status change instead of waiting out the
TTL. Skipped to avoid changing the `AuthService` constructor, which would also
require reworking `auth.service.spec.ts`.

---

## New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TENANT_ROOT_DOMAINS` | `""` | Comma-separated root domains for subdomain workspace resolution |
| `TENANT_SCOPE_MODE` | `warn` | `off` / `warn` / `enforce` for Prisma tenant scoping |
| `AUTH_IDENTITY_CACHE_MS` | `5000` | TTL for the per-request identity lookup; `0` disables |

## Test files added

| File | Tests |
|---|---|
| `backend/src/prisma/tenant-scope.spec.ts` | 26 |
| `backend/src/auth/jwt.strategy.spec.ts` | 14 |
| `backend/src/auth/auth.service.spec.ts` | +11 |
| `backend/src/common/guards/apikey.guard.spec.ts` | 9 |

## Still open

- **C2(b)** — database `FORCE ROW LEVEL SECURITY`, deferred by decision
- **H2** — tokens in `sessionStorage` on the frontend
- **H3** — SSO email resolution
- **H4** — SSO `clientSecret` stored in plaintext despite `CryptoService` existing
- **H5** — tenant isolation tests (partly covered by C2(a))
- **H6** — hard-coded secrets in `.github/workflows/ci.yml`
- **H7** — in-memory throttler storage, ineffective across multiple instances
- **H8**, **M1–M10**, **L1–L4** — see the Notion tracker
