# Phase 3 — Admin dashboards + Affiliate portal + Reporting

## Compact design system (part 1)

Whole UI tightened per request: **smaller fonts, smaller gaps, much less spacing.**

- Type scale (px): `base`=13, `sm`=12, `xs`=11, `2xs`=10, `lg`=15.
- Spacing: page `p-4`, card `p-3`, grid `gap-2`, table rows `py-1.5`, sidebar `w-48`, header `h-12`.
- Tokens in `tailwind.config.ts` + `globals.css` — every new screen inherits the compact look.

## Admin portal (real API data)

`/dashboard` · `/affiliates` (approve) · `/stores` · `/orders` · `/commissions` (approve/reverse) · `/reports`

## Part 2 — Analytics, exports & affiliate portal

### Backend

| Module | Endpoints |
|---|---|
| `reports` | `GET /reports/summary`, `/timeseries`, `/top-affiliates`, `/export?entity=commissions|orders` (CSV) |
| `portal` | `GET /portal/summary`, `/links`, `/orders`, `/commissions` (scoped to `req.user.affiliateId`) |

- JWT now carries `affiliateId`; login response tells the client whether to route to admin or portal.
- Reports aggregate revenue/commissions/active affiliates/orders + a daily time series + top affiliates (groupBy).
- CSV export streams `text/csv` with a download disposition.

### Frontend

- **Dashboard** now wired to real aggregates + an inline SVG area chart (revenue vs commissions), top-affiliates list.
- **Reports** page: 7/30/90-day range, KPIs, chart, and one-click CSV export (orders + commissions).
- **Affiliate portal** (`/portal`): own compact shell — Overview (balance, pending, lifetime, conversion rate), My links, Orders, Earnings.
- Fixed login to read `access_token`; stores user and routes admins vs affiliates.

### Seed demo data

12 days of orders + clicks + conversions + commissions (mixed statuses) so dashboards/portal show real numbers.

- Admin: `admin@demo.test` / `password123`
- Affiliate portal: `affiliate@demo.test` / `password123`

## Next: Phase 4 — Payouts (all methods)
