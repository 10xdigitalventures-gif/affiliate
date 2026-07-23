# Reports & Analytics

Admin performance analytics. Code: `src/reports/`.

## Date range

All endpoints accept either:

- `days` (default 30), or
- `from` + `to` (ISO date or datetime)

## Endpoints (`/v1/reports`, permission `reports.read`)

| Method | Path | Description |
|---|---|---|
| GET | `/summary` | Revenue, commissions, orders, clicks, AOV, EPC, conversion rate, commission rate |
| GET | `/timeseries` | Daily buckets: revenue, commissions, orders, clicks |
| GET | `/top-affiliates` | Ranked affiliates with EPC, CR, orders, revenue |
| GET | `/by-store` | Per-store revenue / orders / commissions |
| GET | `/by-product` | Top products by line revenue |
| GET | `/by-category` | Category rollup |
| GET | `/export?entity=` | CSV: `commissions` \| `orders` \| `affiliates` |

### Summary fields

```ts
{
  revenue, commissions, activeAffiliates, orders,
  clicks, attributedOrders, aov,
  conversionRate,  // attributedOrders / clicks
  epc,             // commissions / clicks
  commissionRate,  // commissions / revenue
  range: { from, to, days }
}
```

### Metrics

- **AOV** — average order value in range
- **EPC** — earnings per click (commissions ÷ clicks)
- **Conversion rate** — attributed orders ÷ clicks
- **Commission rate** — commissions ÷ revenue

## Web

Reports page: range tabs + custom from/to, expanded stat cards, chart, top affiliates table, store/product/category breakdowns, CSV exports.

## Tests

`src/reports/reports.service.spec.ts` — summary metrics, custom range, timeseries buckets, top affiliates EPC, byStore/byProduct/byCategory, CSV.

## Local

```bash
npm test -- reports
```
