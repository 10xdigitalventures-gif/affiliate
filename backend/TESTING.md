# Test Coverage (Phase 22)

Unit tests for critical money/path modules. Run from `backend/`:

```bash
npm install
npm test
# or focused:
npm test -- orders
npm test -- payouts
npm test -- webhooks
npm test -- applications
npm test -- reports
npm test -- tracking
npm test -- coupons
npm test -- links
```

## Spec inventory

### Pre-existing
| File | Focus |
|---|---|
| `auth/auth.service.spec.ts` | login, refresh rotation, reuse, reset, invite |
| `attribution/attribution.service.spec.ts` | last/first/linear/position, coupon, lifetime |
| `fraud/fraud.service.spec.ts` | scoring, thresholds, allowlist, review create |
| `commissions/commissions.service.spec.ts` | commission engine |
| `commissions/multi-tier.service.spec.ts` | sub-affiliate overrides |
| `commissions/product-overrides.service.spec.ts` | product/category rules |
| `apikeys/apikeys.service.spec.ts` | key hash + verify |
| `bulk/csv.util.spec.ts` | CSV parse/build |
| `payouts/providers/payout-provider.service.spec.ts` | provider routing |

### Added in Phase 22
| File | Cases cover |
|---|---|
| `orders/orders.service.spec.ts` | store missing; no attribution; fraud allow → commission; review queue; multi-touch split; refund; list |
| `payouts/payouts.service.spec.ts` | createBatch; approve/fail guards; markPaid settle; process paid/fail; portal requestPayout |
| `webhooks/webhooks.service.spec.ts` | unknown store; bad signature; dedupe; order ingest; refund topic; retry on failure |
| `applications/applications.service.spec.ts` | closed signup; duplicate; pending apply; auto-approve; approve/reject |
| `reports/reports.service.spec.ts` | summary; timeseries buckets; topAffiliates; CSV export |
| `tracking/tracking.service.spec.ts` | unknown short code; IP hash click; null IP |
| `coupons/coupons.service.spec.ts` | create/assign/findByCode validation |
| `links/links.service.spec.ts` | create shortCode; list; not found |

## Style

- Prisma and collaborators are **jest mocks** (no DB).
- Prefer direct `new Service(deps)` or `Test.createTestingModule` — both used in repo.
- Assert **behaviour** (status transitions, which collaborator called), not implementation trivia.

## Still thin / next

- `stores`, `integrations/*` (HMAC map helpers), `portal`, `settings`, `mail`, `bulk.service` (not just csv.util)
- e2e / supertest against Nest app
- CI already runs `npm test` when package-lock present (Phase 15)

## Sandbox note

This environment often lacks `node_modules` / network install — tests are authored to run **locally** after `npm install`.
