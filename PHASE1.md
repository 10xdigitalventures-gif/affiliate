# Phase 1 — Core tracking & commission engine

Built on top of Phase 0. New backend modules:

| Module | Responsibility |
|---|---|
| `links` | Affiliate referral links + unique short codes |
| `tracking` | Public redirect `/v1/track/r/:shortCode` — records click, sets 60-day `aff_ref` cookie (last-click), redirects |
| `coupons` | Coupon creation + affiliate assignment |
| `attribution` | Resolves the owning affiliate: **coupon > cookie (last-click) > lifetime** |
| `commissions` | Rule matching + amount calc + ledger (pending → approved → payable → paid) + reversals/refunds |
| `orders` | Normalised order ingest — runs attribution + generates commission (idempotent) |

## End-to-end flow

```
visitor clicks  /v1/track/r/AB123XY
     → Click recorded, aff_ref=ABAAN001 cookie set (60 days)
     → redirect to store
checkout → storefront/webhook POSTs /v1/orders/ingest with referralCode/couponCode
     → AttributionService picks affiliate (coupon first, else cookie, else lifetime)
     → CommissionsService finds best rule, creates pending commission + conversion
admin approves → payable → (Phase 4) payout
refund → POST /v1/orders/:id/refund → proportional reversal adjustment
```

## Try it (after seed)

```bash
# 1. login
curl -sX POST localhost:4000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@demo.test","password":"password123"}'

# 2. ingest an order attributed via coupon (use TOKEN + STORE_ID from seed output)
curl -sX POST localhost:4000/v1/orders/ingest -H "authorization: Bearer TOKEN" \
  -H 'content-type: application/json' \
  -d '{"storeId":"STORE_ID","externalOrderId":"1001","subtotal":200,"total":200,"couponCode":"ABAAN10"}'
# → creates a $20 pending commission (global 10% rule)

# 3. or attribute via last-click cookie value
#   ..."referralCode":"ABAAN001"   (no coupon)
```

## Attribution priority (configurable)

1. **Coupon** — if checkout used an affiliate-assigned coupon
2. **Cookie (last-click)** — most recent click within the 60-day window
3. **Lifetime** — customer's first-ever referring affiliate

## Next: Phase 2 — Shopify + WooCommerce integration (parallel) + normalisation layer
