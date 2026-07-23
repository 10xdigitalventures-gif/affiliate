# Phase 2 — Shopify + WooCommerce integration (parallel) + normalisation

Both platforms are wired in parallel and funnel into the same platform-agnostic engine from Phase 1.

## New backend modules

| Module | Responsibility |
|---|---|
| `common/crypto` | AES-256-GCM envelope encryption for store credentials + webhook secrets |
| `stores` | Connect store (encrypted creds), list, webhook context, sync status |
| `integrations/shopify` | HMAC verify (`X-Shopify-Hmac-Sha256`) + order/refund payload mapping |
| `integrations/woocommerce` | HMAC verify (`X-WC-Webhook-Signature`) + order/refund payload mapping |
| `webhooks` | Public inbound endpoints, idempotency, routing to ingest/refund |

## Normalisation layer

Each connector maps its native payload into the shared `IngestOrderDto`:

```
Shopify order  ─┐
                ├─→  IngestOrderDto  ─→  OrdersService.ingest()  ─→  attribution + commission
Woo order      ─┘        (same engine, platform-agnostic)
```

Attribution signals pulled from each platform:
- **referralCode**: Shopify `note_attributes[aff_ref]` / Woo `meta_data[aff_ref]` (set from the `aff_ref` cookie at checkout)
- **couponCode**: Shopify `discount_codes[0]` / Woo `coupon_lines[0]`

## Webhook endpoints (public)

```
POST /v1/webhooks/shopify/:storeId
POST /v1/webhooks/woocommerce/:storeId
```

- Signature verified from the **raw** body (rawBody enabled in `main.ts`).
- **Idempotency**: every delivery stored as `WebhookEvent` keyed by platform webhook id; re-deliveries are skipped.
- Topic routing: `orders/*` or `order.*` → ingest; anything matching `refund` → proportional reversal.
- Always returns `200` quickly; failures are recorded with `attempts` for retry/monitoring (queue-based retry lands in Phase 5).
- Dev mode: if a store has no webhook secret and `NODE_ENV !== production`, unsigned webhooks are allowed for local testing; in production they are rejected.

## Connect a store

```bash
curl -sX POST localhost:4000/v1/stores/connect -H "authorization: Bearer TOKEN" \
  -H 'content-type: application/json' -d '{
    "platform":"woocommerce","name":"My Woo","domain":"shop.example.com",
    "consumerKey":"ck_...","consumerSecret":"cs_...","webhookSecret":"whsec_demo"
  }'
```

Credentials are encrypted at rest (never returned in API responses).

## Next: Phase 3 — Admin + Affiliate dashboards + reporting
