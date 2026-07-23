# Phase 4 — Payouts

## Overview

Full payout lifecycle for all 6 payout methods: **Bank / Wise / PayPal / Stripe / Manual / Crypto**.

## Backend

### New module: `payouts`

| Endpoint | Role | Description |
|---|---|---|
| GET /payouts | admin | List payouts (filterable by status) |
| GET /payouts/:id | admin | Detail with payout items |
| POST /payouts/batch | admin | Create batch from affiliate's payable commissions |
| PATCH /payouts/:id/approve | admin | requested -> approved |
| PATCH /payouts/:id/mark-paid | admin | approved -> paid; commissions -> paid; balance deducted |
| PATCH /payouts/:id/fail | admin | -> failed |

### Portal additions

| Endpoint | Description |
|---|---|
| GET /portal/payouts | Affiliate's own payout history |
| POST /portal/payouts/request | Request payout from payable commissions |
| GET /portal/payout-methods | Saved payout methods |
| POST /portal/payout-methods | Add a payout method |
| DELETE /portal/payout-methods/:id | Remove a method |

### Payout lifecycle

```
Payable commissions
       |
  createBatch / requestPayout
       |
  Payout (status: requested)
       |
    approve
       |
  Payout (status: approved)
       |
   mark-paid
       |
  Payout (status: paid)
  Commissions (status: paid)
  Affiliate.availableBalance -= amount
```

Commissions are linked via `Commission.payoutItemId -> PayoutItem.id` (set after batch creation).

### Permissions

- `payouts.read` — list/view payouts
- `payouts.write` — create batches, approve, mark-paid, fail

## Frontend

### Admin `/payouts`

- Status filter tabs (All / Requested / Approved / Paid / Failed)
- Inline approve / mark-paid / fail action buttons per row
- "New batch" panel: select affiliate + method + currency

### Affiliate portal `/portal/payouts`

- Request payout card: choose method, click request
- Saved payment methods: add / remove (bank, wise, paypal, stripe, manual, crypto)
- Full payout history table

## Seed

- `PayoutMethodRecord` for demo affiliate (bank, isDefault: true)
- One demo approved payout (2 commissions) so admin page has data on first run

## Next: Phase 5 — Fraud & hardening

BullMQ queue-based webhook retry, fraud checks (self-referral, velocity, IP dedup), health monitoring, audit log.
