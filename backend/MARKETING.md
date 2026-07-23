# Links & Coupons

Tracking links and discount coupons were previously create-only stubs. They now
have full lifecycle management, filtering, stats, and a dashboard.

## Coupons (`/v1/coupons`, JWT)

| Method | Path | Perm | Purpose |
| --- | --- | --- | --- |
| GET | `/coupons` | affiliates.read | List; filters `storeId`, `affiliateId`, `status`, `search` (by code) |
| GET | `/coupons/stats` | affiliates.read | `{ total, active, disabled, expired, assigned, unassigned }` |
| GET | `/coupons/:id` | affiliates.read | Single coupon (store, affiliate, order count) |
| POST | `/coupons` | affiliates.write | Create one coupon |
| POST | `/coupons/bulk-generate` | affiliates.write | Generate N unique codes |
| PATCH | `/coupons/:id` | affiliates.write | Update code / type / status / affiliate / expiry |
| POST | `/coupons/:id/assign/:affiliateId` | affiliates.write | Assign to an affiliate |

- **Bulk generate** — `{ storeId, count (1-500), prefix?, length? (4-12), affiliateId?, discountType? }`.
  Codes use an unambiguous alphabet (no 0/O/1/I) and are checked for uniqueness per store.
- **Update** — `affiliateId: null` clears assignment, `expiresAt: null` clears expiry, `expiresAt: <ISO>` sets it.
- **Attribution safety** — `findByCode` now only matches `status: active` AND not-yet-expired coupons, so disabled/expired codes no longer attribute conversions.

## Links (`/v1/links`, JWT)

| Method | Path | Perm | Purpose |
| --- | --- | --- | --- |
| GET | `/links` | affiliates.read | Org-wide list; filters `affiliateId`, `storeId`, `campaignId`, `search` |
| GET | `/links/stats` | affiliates.read | `{ total, totalClicks }` |
| GET | `/links/affiliate/:affiliateId` | affiliates.read | Links for one affiliate |
| GET | `/links/:id` | affiliates.read | Single link |
| POST | `/links` | affiliates.write | Create link (optional custom vanity `shortCode`) |
| PATCH | `/links/:id` | affiliates.write | Update destination / store / campaign |
| DELETE | `/links/:id` | affiliates.write | Delete (blocked if the link has recorded clicks) |

- **Full short URL** — every link response now includes `shortUrl`
  (`<TRACKING_BASE_URL>/track/r/<shortCode>`) and a numeric `clicksCount`
  (BigInt coerced to Number so JSON serialisation is safe).
- **Custom codes** — optional `shortCode` (3-20 chars: letters, numbers, `-`, `_`);
  duplicates are rejected with 409. Auto codes retry on collision.
- **Delete guard** — links with clicks cannot be hard-deleted (FK-safe); a 409 is returned.

### Env

- `TRACKING_BASE_URL` (falls back to `API_URL`, then `http://localhost:4000/v1`) — base used to build `shortUrl`.

## Dashboard

New **Links & Coupons** nav item (Megaphone icon) at `/marketing` with two tabs:

- **Links** — stat cards, affiliate/search filters, create form (custom code), copy-to-clipboard, delete.
- **Coupons** — stat cards, status/search filters, single create, bulk generate, enable/disable toggle.

## Sandbox note

Tests run only locally: `npm test -- coupons links`. No new migration (Coupon /
AffiliateLink models and their fields already exist in the schema).
