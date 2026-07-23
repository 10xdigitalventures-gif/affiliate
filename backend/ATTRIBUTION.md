# Attribution Models

Resolves which affiliate(s) earn credit for an order. Code: `src/attribution/`.

## Priority chain

1. **Coupon** (if `couponPriority=true` and coupon has an affiliate)
2. **Cookie path** — last-click / first-click / linear / position multi-touch
3. **Lifetime** — customer’s `firstAffiliateId` (if `lifetimeEnabled`)

When `couponPriority=false`, cookie/lifetime run first; coupon is a fallback.

## Cookie models (`cookieModel`)

| Model | Credit |
|---|---|
| `last_click` (default) | 100% last unique affiliate in the session path |
| `first_click` | 100% first unique affiliate in the path |
| `linear` | Equal split across unique affiliates in path |
| `position` | 40% first + 40% last + 20% middle (equal); 2 touches → 50/50 |

### Touch path

Built from **clicks sharing the same `ipHash`** within `cookieWindowDays` (default 60),
stitching from the referral cookie’s last click → IP → ordered unique affiliates.
If no IP is available, falls back to single-affiliate last click (legacy behaviour).

## Settings (`Organization.settings`)

| Key | Default |
|---|---|
| `cookieModel` | `last_click` |
| `cookieWindowDays` | 60 (or `DEFAULT_COOKIE_WINDOW_DAYS`) |
| `couponPriority` | `true` |
| `lifetimeEnabled` | `true` |

### API

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/settings/attribution` | `settings.write` |
| PATCH | `/v1/settings/attribution` | `settings.write` |

Body example:

```json
{ "cookieModel": "linear", "cookieWindowDays": 30, "couponPriority": true, "lifetimeEnabled": true }
```

## Result shape

```ts
{
  affiliateId: string       // primary (highest weight / model winner)
  method: 'coupon' | 'cookie' | 'lifetime' | 'manual'
  model: CookieModel | 'coupon' | 'lifetime' | 'manual'
  clickId?: string | null
  couponId?: string | null
  shares: { affiliateId, weight, clickId?, role }[]  // weights sum ≈ 1
}
```

## Commission split

Order ingest (`orders.service`):

- Single share / last / first → `generateForOrder` (unchanged)
- `linear` / `position` with multiple shares → `generateSplitForOrder`
  - Full order commission computed once (primary affiliate rules)
  - Each share gets `amount × weight`
  - Sub-affiliate overrides run on the primary share only

## Web

Settings → **Attribution** card: model select, window days, coupon priority, lifetime toggle.

## Tests

`src/attribution/attribution.service.spec.ts` — coupon, last/first click, linear, position, lifetime off, settings update.

## Local

```bash
npm install && npm test -- attribution
```

No new migration (settings live in org JSON).
