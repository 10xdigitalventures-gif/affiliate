# Phase 5 — Fraud & Hardening

## Overview

Three pillars: **BullMQ webhook retry**, **fraud checks** on order ingestion, and **audit log** on sensitive mutations.

## 1. BullMQ Webhook Retry Queue

### New: `src/queue/`

- `QueueService` — wraps BullMQ `Queue` (Redis-backed), provides `addRetry(eventId, attempt)` with exponential backoff:
  - Attempt 0 → delay 5s
  - Attempt 1 → delay 30s
  - Attempt 2 → delay 5min (final)
  - Attempt 3+ → silently dropped

### New: `src/webhooks/webhook-retry.worker.ts`

- `WebhookRetryWorker` — NestJS service in `WebhooksModule`, starts a BullMQ `Worker` in `onModuleInit`.
- Fetches `WebhookEvent` from DB, calls `WebhooksService.reprocessEvent()` (signature-check skipped on retry).
- New `reprocessEvent(event)` method added to `WebhooksService`.

### Flow

```
Incoming webhook
  |-> WebhooksService.process() fails
      |-> event.status = failed, attempts++
      |-> QueueService.addRetry(eventId, attempts)   [BullMQ job]
          |-> delay 5s/30s/5min based on attempt
          |-> WebhookRetryWorker picks up
              |-> reprocessEvent() [no sig check]
                  |-> success: status = processed
                  |-> fail again: attempts++, re-enqueue (max 3 total)
```

### Env vars

```
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 2. Fraud Detection

### New: `src/fraud/fraud.service.ts`

Called inside `OrdersService.ingest()` **before** `CommissionsService.generateForOrder()`.

| Check | Condition | Action |
|---|---|---|
| Self-referral | affiliate.userId == customer email's user | Block commission |
| Order velocity | same customer+affiliate, >=5 orders in 24h | Block commission |
| IP velocity | same ipHash, >=15 clicks in 1h for affiliate | Block commission |

If blocked: commission is skipped, order is still created.

## 3. Audit Log

### New: `src/audit/`

- `AuditService.log({organizationId, action, resourceType, resourceId, oldValue, newValue})` — writes to `AuditLog` table.
- Called (fire-and-forget, never throws) on:
  - `CommissionsService.approve()`
  - `PayoutsService.approve()` + `markPaid()`
- `GET /audit?limit=N` (permission: `settings.write`) — admin audit log viewer.

### Frontend

- `/settings` page (was ComingSoon) — now shows a paginated audit log table with action, resource type+id snippet, user, and timestamp.

## Architecture note

No circular deps: QueueModule has no imports, WebhooksModule imports QueueModule, FraudModule/AuditModule are standalone.

## Running

```bash
# Redis required for webhook retry queue
docker run -d -p 6379:6379 redis:7-alpine

cd backend && npm run start:dev
cd web && npm run dev
```

## Next: Phase 6 — GHL integration

GoHighLevel OAuth app, funnel/order/subscription conversion events, normalisation into existing Order model.
