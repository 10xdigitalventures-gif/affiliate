# MentoringHub Affiliate Platform — Partner Portal v7.2

Multi-tenant affiliate SaaS for Shopify, WooCommerce and custom stores. The
release contains a platform super-admin console, isolated tenant workspaces,
private affiliate portals, billing, commission and payout ledgers, team RBAC,
fraud review, reporting, branded onboarding and Cloudflare-ready deployment.

## Runtime architecture

| Experience | Route | Scope |
|---|---|---|
| Platform operator | `/admin` | Cross-tenant plans, billing and tenant lifecycle |
| Tenant owner/staff | `/dashboard` | Current organization only, controlled by live RBAC |
| Approved affiliate | `/portal` | The signed-in affiliate's own data only |

Public URLs on the current Windows test host:

- App, login and API: `https://affiliate.mentoringhub.online` (`/v1` for API)
- Marketing: `https://web.mentoringhub.online`

Local ports deliberately avoid the existing JIL project:

- Affiliate API `4100`
- Affiliate web `3100`
- Affiliate marketing `3002`
- Existing JIL/WA services remain independently managed

## Current stack

- NestJS 11, Prisma 6, PostgreSQL, Redis/BullMQ
- Next.js 15, React 18, TypeScript, Tailwind CSS
- Passwordless email codes, Argon2id fallback passwords, rotating HttpOnly-cookie sessions, optional 2FA and OIDC
- PM2 + Cloudflare Tunnel for Windows team testing
- Immutable non-root Docker images with tagged rollback for the final Linux move

## Secure administrator bootstrap

No production password is embedded in source, seed data or the ZIP. The Windows
and Linux deployment flows ask for an operator-supplied strong password and
idempotently prepare the selected account. For this installation the email is:

`abaanshujat@gmail.com`

Sign in at `https://affiliate.mentoringhub.online/login` with the one-time code
sent to the account email. Codes expire after 10 minutes, are single-use and
allow at most five attempts. Password and enterprise SSO remain available under
**Other sign-in options**. A workspace is only needed for password/SSO when the
same email belongs to more than one tenant.

## Development

Node.js 20.11 or newer is required. Start PostgreSQL and Redis, copy the example
environment files, then:

```bash
npm --prefix backend ci
npm --prefix web ci
npm --prefix marketing ci
npm --prefix backend run prisma:generate
npm --prefix backend run db:prepare
(cd backend && npx prisma migrate deploy)
npm --prefix backend run build
npm --prefix web run build
npm --prefix marketing run build
```

For a completely empty database only, supply `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`, then run `npm --prefix backend run prisma:seed`. Existing
systems use migrations plus `npm --prefix backend run admin:ensure`.

## Deployment

- Windows 11 replacement and Cloudflare: [`deploy/WINDOWS-CLOUDFLARE.md`](deploy/WINDOWS-CLOUDFLARE.md)
- Final Linux/Docker move: [`deploy/SERVER-DEPLOY.md`](deploy/SERVER-DEPLOY.md)
- Release/security details: [`RELEASE-v7.md`](RELEASE-v7.md)
- v7.2 organization and plan management: [`RELEASE-v7.2.md`](RELEASE-v7.2.md)

The Windows deployer replaces only `affiliate-backend`, `affiliate-web` and
`affiliate-marketing`. It does not delete/restart `jil-*`, `wa-client-hub` or any
unrelated PM2 application.
