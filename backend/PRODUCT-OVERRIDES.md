# Product- & Category-Level Commission Overrides

Different commission rates per **product** or **category**, evaluated **per order line item**,
with a clean fallback to order-level rules. Engine lives in `src/commissions/`.

## Rule scopes & precedence

A `CommissionRule` has a `scope`, an optional `scopeRefId`, a `type`, a `value`, and a `priority`.

Selection per line item:
1. Highest `priority` wins.
2. On equal priority, the more specific scope wins: **affiliate > product > category > store > campaign > global**.

## How an order is computed (`computeOrderCommission`)

1. Load the order's line items (`OrderItem` → `Product` → `categoryId`).
2. Load candidate rules: global + this store + this affiliate + any product/category rules matching the order's items.
3. **If any product/category rule exists** and the order has items → **per-line** mode:
   - For each line, pick the best matching rule and compute its amount.
   - `percentage` / `tiered` / `recurring`: `unitPrice * quantity * value / 100`.
   - `fixed`: `value * quantity` (per-unit).
   - Line commission is persisted on `OrderItem.commissionAmount`; the sum becomes the commission total.
4. **Otherwise** → order-level mode (unchanged legacy behavior): one best rule applied to `order.subtotal`.

The generated `Commission` stores the total; `commissionRuleId` points at a representative rule
(the first line's rule in per-line mode). Multi-tier overrides and refund/reversal logic run on the
total exactly as before, so this is fully backward compatible.

## Managing rules (API)

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/commission-rules` | `commissions.read` |
| POST | `/v1/commission-rules` | `commissions.write` |
| DELETE | `/v1/commission-rules/:id` | `commissions.write` |

`POST` body (`CreateCommissionRuleDto`, class-validated):

```json
{ "scope": "product", "scopeRefId": "<productId>", "type": "percentage", "value": 15, "priority": 0 }
```

- `scopeRefId` is required for every scope except `global`.
- The referenced product / category / store / affiliate is validated to belong to your organization.
- Create & delete are written to the audit log.

## Web UI

Commissions page → **Commission rules**: add a rule (scope + ref id + type + value + priority), see all
rules sorted by precedence, and delete rules.

## Tests

`src/commissions/product-overrides.service.spec.ts`:
- Per-product rule beats category on scope rank; category applies to other line.
- Fixed rule applied per-unit.
- Higher-priority order-level rule overrides product scope rank.
- Fallback to order-level when no product/category rules exist.
