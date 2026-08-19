# Unified Affiliate Management Platform

![CI](https://github.com/10xdigitalventures-gif/affiliate/actions/workflows/ci.yml/badge.svg)
![Docker Build](https://github.com/10xdigitalventures-gif/affiliate/actions/workflows/docker.yml/badge.svg)

Multi-store affiliate & referral management platform for **Shopify + WooCommerce** (GoHighLevel later). Standalone multi-merchant SaaS.

> CI/CD runs on GitHub Actions — see `CI.md`.

Built from the SRS (`Unified_Affiliate_Management_Platform_SRS`). This repo is delivered **phase by phase**.

## Monorepo layout

```
affiliate-platform/
├── backend/     NestJS 10 + Prisma + PostgreSQL (API, integrations, engine)
├── web/         Next.js 14 (App Router) + Tailwind (Admin + Affiliate portals)
├── docker-compose.yml
└── .env.example
```

## Stack

- **Backend:** NestJS 10, Prisma 5, PostgreSQL 15, Redis, BullMQ, JWT + RBAC
- **Web:** Next.js 14, TypeScript, Tailwind CSS, Inter
- **Infra:** Docker

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: monorepo, multi-tenant auth/RBAC, Prisma schema, app shell + design system | ✅ this delivery |
| 1 | Core engine: affiliates, links, coupons, click tracking, attribution, commission ledger | ⏳ next |
| 2 | Shopify + WooCommerce integration (parallel) + normalisation layer | ⏳ |
| 3 | Admin + affiliate dashboards + reporting | ⏳ |
| 4 | Payouts (all methods) | ⏳ |
| 5 | Fraud, integration health, audit, hardening | ⏳ |
| 6 | GoHighLevel integration | ⏳ |

## Confirmed decisions

- Multi-merchant SaaS (tenant = organization)
- Shopify + WooCommerce built in parallel
- Payout methods: bank, Wise, PayPal, Stripe, manual, crypto-ready
- Attribution default: **last-click, 60-day cookie**

## Quick start

```bash
cp .env.example .env
docker compose up -d db redis      # start Postgres + Redis

cd backend
npm install
npx prisma migrate dev             # create schema
npm run start:dev                  # API on :4000

cd ../web
npm install
npm run dev                        # web on :3000
```
