# Plans, Entitlements, Super Admin, Branding & Custom Domains

This document describes the enterprise / multi-tenant SaaS layer added on top of the
affiliate platform: how the platform owner packages features into plans, how tenants are
gated by those plans, and how white-label branding and custom login domains work.

## 1. Concepts

- **Platform owner (super admin)** — you. Creates packages (plans), assigns them to tenants,
  manages tenant lifecycle, and sees platform-wide billing/usage.
- **Tenant (organization)** — a paying customer. Gets features and limits based on the plan
  attached to its subscription.
- **Plan (package)** — a named bundle of feature flags + numeric limits + price.
- **Subscription** — links one organization to one plan, with status + optional per-tenant
  overrides.
- **Entitlements** — the resolved set of features + limits for an organization, computed as
  `denied-by-default baseline -> plan -> per-tenant overrides`.

## 2. Feature flags & limits

Defined in `src/entitlements/entitlements.constants.ts`.

Features: `apiAccess`, `webhooks`, `fraudTools`, `multiTierCommissions`, `advancedReports`,
`bulkOperations`, `branding`, `customDomain`, `prioritySupport`.

Limits (numeric, `-1` = unlimited): `affiliates`, `stores`, `teamMembers`, `apiKeys`.

Default seeded packages:

| Plan | Price | Affiliates | Stores | Team | API keys | Notable features |
|------|-------|-----------|--------|------|----------|------------------|
| Starter | $49/mo | 50 | 1 | 2 | 1 | (none) |
| Growth | $149/mo | 1000 | 5 | 10 | 5 | API, webhooks, fraud, multi-tier, reports, bulk, branding |
| Enterprise | $499/mo | ∞ | ∞ | ∞ | ∞ | everything incl. custom domain + priority support |

## 3. Enforcement

- **Feature gating** — `@RequireFeature('key')` + `FeatureGuard` on a controller/route.
  Super admins bypass. Returns 403 with an upgrade message when denied.
- **Limit gating** — services call `EntitlementsService.assertWithinLimit(orgId, 'affiliates')`
  before creating a record. Wired into:
  - `AffiliatesService.create` → `affiliates`
  - `StoresService.connect` → `stores`
  - `ApiKeysService.create` → `apiAccess` feature + `apiKeys` limit
- **Resolution** — `EntitlementsService.getContext(orgId)` merges baseline + plan + overrides.
  A missing/canceled subscription falls back to denied-by-default.

## 4. API surface

### Tenant-facing
- `GET /v1/entitlements` — current org features, limits, live usage.
- `GET /v1/plans` — public pricing (visible, non-archived plans).
- `GET /v1/branding` / `PATCH /v1/branding` — read/update white-label branding
  (PATCH requires `settings.write` + `branding` feature).
- `GET /v1/public/branding?hostname=&slug=` — unauthenticated branding resolution for the
  branded login page.
- `GET/POST /v1/domains`, `POST /v1/domains/:id/verify`, `POST /v1/domains/:id/primary`,
  `DELETE /v1/domains/:id` — custom domains (requires `settings.write` + `customDomain`).

### Super-admin (`JwtAuthGuard` + `SuperAdminGuard`)
- `GET /v1/admin/overview` — tenants, MRR, active subscriptions, plan distribution.
- `GET/POST /v1/admin/plans`, `GET/PATCH/DELETE /v1/admin/plans/:id` — package CRUD
  (delete archives instead when the plan still has subscribers).
- `GET /v1/admin/tenants`, `GET /v1/admin/tenants/:id` — tenant list/detail.
- `PATCH /v1/admin/tenants/:id/plan` — assign/move a tenant to a plan.
- `PATCH /v1/admin/tenants/:id/status` — activate / trial / suspend a tenant.

## 5. Branding (white-label)

Stored in `Organization.settings.branding` (no extra table). Fields: companyName, logoUrl,
faviconUrl, primaryColor, accentColor, loginHeadline, supportEmail, hidePlatformBranding.
The public resolver matches by active custom domain hostname first, then by org slug.

## 6. Custom login domains

Model `Domain` (hostname unique, status pending/verifying/active/failed, verificationToken,
isPrimary). Flow:
1. Tenant adds `affiliates.theirbrand.com`.
2. We return DNS instructions: a `CNAME` to `CUSTOM_DOMAIN_TARGET`
   (env, default `ingress.affiliate-platform.app`) and a `TXT` record at
   `_affiliate-verify.<hostname>` = token.
3. Tenant clicks **Verify** → we read the TXT record via DNS and, on match, mark the domain
   `active`. One domain can be set **primary**.
4. Branded login resolves branding via `GET /v1/public/branding?hostname=...`.

> Production note: pointing the CNAME at your ingress + issuing TLS certificates per custom
> domain (e.g. via a reverse proxy / ACME automation) is an infra step outside the app code.

## 7. Front-end

- `/billing` — tenant: current plan, usage vs limits, feature list, available packages.
- `/branding` — tenant: white-label editor with live preview.
- `/domains` — tenant: add/verify/remove custom domains with DNS instructions.
- `/admin` — super admin only (shown in the sidebar when `user.isSuperAdmin`): Overview,
  Packages (create/edit plans), Tenants (assign plans, change status).

## 8. Migrations & seed

- `prisma/migrations/20260712_plans_entitlements/migration.sql` — `Plan`, `Subscription`,
  `User.isSuperAdmin`, enums.
- `prisma/migrations/20260713_custom_domains/migration.sql` — `Domain` + enum.
- `prisma/seed.ts` — idempotently seeds the three default packages, assigns the
  supplied organization to Enterprise and prepares the operator-supplied
  super-admin email. It has no built-in password.
