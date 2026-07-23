# Fraud Scoring & Review Queue

Risk scoring for attributed orders, configurable thresholds, and a manual review
queue. Code lives in `src/fraud/`.

## Decision model

`checkOrder` returns:

```ts
{
  blocked: boolean        // true when decision === 'block' (legacy-compatible)
  decision: 'allow' | 'review' | 'block'
  score: number           // 0–100
  reasons: string[]       // signal codes
  signals: { code, weight, detail? }[]
  reason?: string         // first reason (legacy)
}
```

| Score | Default thresholds | Action |
|---|---|---|
| `< 40` | below review | **allow** — commission generated immediately |
| `≥ 40` and `< 80` | review | **review** — no commission; `FraudReview` row created |
| `≥ 80` | block | **block** — no commission; review row still recorded for audit |

## Signals (weights)

| Code | Weight | Trigger |
|---|---|---|
| `self_referral` | 100 | Affiliate user email === customer email |
| `order_velocity` | 50 | ≥ N orders for same customer+affiliate in window (default 5 / 24h) |
| `ip_velocity` | 40 | ≥ N clicks from same `ipHash` in window (default 15 / 60m) |
| `new_affiliate_burst` | 25 | Affiliate < 48h old with ≥ 3 attributed orders |
| `high_value` | 15 | Order total ≥ 1000 |
| `duplicate_customer_orders` | 20 | Customer already has an open fraud review |

Signals stack (capped at 100). Org can **allowlist** affiliate IDs to skip all checks.

## Settings (`Organization.settings.fraud`)

| Key | Default |
|---|---|
| `reviewThreshold` | 40 |
| `blockThreshold` | 80 |
| `orderVelocityLimit` | 5 |
| `orderVelocityWindowHours` | 24 |
| `ipVelocityLimit` | 15 |
| `ipVelocityWindowMinutes` | 60 |
| `allowlistAffiliateIds` | `[]` |

## Order ingest flow

1. Attribute order → affiliate.
2. `fraud.checkOrder(...)`.
3. `allow` → `commissions.generateForOrder`.
4. `review` / `block` → `fraud.createReview` (no commission).
5. Response includes `{ fraud: { decision, score, reasons, reviewId? } }`.

## Review queue API (`/v1/fraud`)

| Method | Path | Permission |
|---|---|---|
| GET | `/settings` | `fraud.read` |
| PATCH | `/settings` | `fraud.write` |
| GET | `/reviews?status=` | `fraud.read` |
| POST | `/reviews/:id/approve` | `fraud.write` |
| POST | `/reviews/:id/reject` | `fraud.write` |

- **Approve** generates the commission (attribution method `manual`) and audits `fraud_review.approve`.
- **Reject** marks the review rejected and audits `fraud_review.reject` (no commission).

## Schema

`FraudReview` + enums `FraudDecision`, `FraudReviewStatus`.
Migration: `20260710_fraud_reviews`.
Permissions: `fraud.read`, `fraud.write` (seed).

## Web UI

Sidebar → **Fraud**: open reviews, score/reasons, approve/reject. Settings page can also PATCH thresholds via API.

## Tests

`src/fraud/fraud.service.spec.ts` — clean allow, self-referral block, velocity review, IP review, stacked block, allowlist skip, high-value signal, createReview.

## Local setup

```bash
npm install
npx prisma migrate deploy
npx prisma generate
npm test -- fraud
```
