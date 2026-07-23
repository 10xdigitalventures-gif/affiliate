# Phase 6 — GoHighLevel (GHL) Integration

## Overview

GHL is the third platform connector after Shopify and WooCommerce. Same normalisation layer, same webhook event pipeline, zero new concepts — only a new `GhlService` + endpoint.

## Backend

### New: `src/integrations/ghl.service.ts`

| Method | Description |
|---|---|
| `verifyWebhook(rawBody, header, secret)` | HMAC-SHA256 hex digest, compared to `x-ghl-signature` |
| `mapOrder(storeId, payload)` | Maps GHL order/invoice/subscription payload -> IngestOrderDto |
| `refundAmount(payload)` | Extracts refund amount |
| `refundOrderId(payload)` | Extracts original order id |
| `eventType(typeHeader, payload)` | Classifies topic as order/refund/unknown |

### GHL payload mapping

```
GHL purchase event
  id              -> externalOrderId
  contact.email   -> customerEmail
  amount          -> subtotal + total
  currency        -> currency
  discountCodes[] -> couponCode (first element)
  source.referralCode -> referralCode (affiliate tracking)
  createdAt       -> placedAt
  status          -> status (active/paid -> "paid")
```

### Supported GHL event types

| GHL event | Treatment | Header: x-ghl-event-type |
|---|---|---|
| OrderCreate | order.create | OrderCreate |
| InvoicePaid | order.create | InvoicePaid |
| SubscriptionCreate | order.create (recurring) | SubscriptionCreate |
| OrderRefund | refund | OrderRefund |
| PurchaseCreate | order.create | PurchaseCreate |

### New webhook endpoint

`POST /v1/webhooks/ghl/:storeId`

- Signature verified via `x-ghl-signature` (HMAC-SHA256 hex)
- Idempotency key: `ghl:{storeId}:{x-ghl-webhook-id}`
- Falls through to existing normalisation & attribution pipeline
- Dev mode: unsigned allowed when no secret set + NODE_ENV != production

### Updated `isOrderTopic()` regex

Now matches: `order*`, `orders/*`, `InvoicePaid`, `SubscriptionCreate`, `purchase`

### Retry queue

`reprocessEvent()` now handles `platform === 'ghl'` branch.

## Connecting a GHL Store

### Via admin UI (`/stores` page)

1. Click "Connect store"
2. Select GoHighLevel platform
3. Enter: Store name, GHL Location domain, API Key (access token), Webhook Secret
4. Click Connect

The stored access token is AES-256-GCM encrypted at rest (same as Shopify/WooCommerce).

### Configure GHL webhook

In GHL Settings -> Integrations -> Webhooks:

```
Endpoint URL:  POST https://your-api.com/v1/webhooks/ghl/{storeId}
Events:        OrderCreate, InvoicePaid, SubscriptionCreate, OrderRefund
Secret:        (your webhook secret from store connect form)
```

### Affiliate tracking in GHL funnels

Pass the affiliate ref code in the GHL funnel/order via:
- `source.referralCode` field on the order
- OR a hidden form field mapped to `source.ref`
- OR utm parameter `utm.ref` passed to the page

Or use affiliate coupon codes created in the coupons module — GHL sends coupon codes in `discountCodes[]`.

## Architecture

GHL sits in the **normalisation layer** alongside Shopify and WooCommerce. The attribution engine, commission engine, fraud checks, audit log, and retry queue all apply identically.

```
GHL webhook
  -> POST /v1/webhooks/ghl/:storeId
     -> WebhooksService.handleGhl()
        -> GhlService.verifyWebhook()   [HMAC hex]
        -> GhlService.mapOrder()        -> IngestOrderDto
        -> WebhooksService.process()    [idempotency check]
           -> OrdersService.ingest()
              -> AttributionService.resolve()  [coupon > cookie > lifetime]
              -> FraudService.checkOrder()     [self-ref, velocity]
              -> CommissionsService.generateForOrder()
```

## Running

```bash
cd backend && npm run start:dev
# Register webhook in GHL:
# POST https://your-api.com/v1/webhooks/ghl/{store_id_from_db}
```
