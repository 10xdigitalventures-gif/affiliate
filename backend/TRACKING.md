# Tracking (clicks, pixel, postback)

Code: `src/tracking/`. Public click capture + server-to-server conversions.

## Endpoints (`/v1/track`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/r/:shortCode` | public | Record click → set cookies → 302 to destination |
| GET | `/pixel.gif?ref=CODE` | public | Cookieless click via `<img>` beacon; returns 1×1 GIF |
| POST | `/click` | public | JSON click beacon for JS snippet; returns `clickId` |
| POST | `/postback` | **API key** | S2S conversion → order ingest (attribution + fraud + commission) |

### Cookies set

- `aff_ref` = affiliate code (last-click, `DEFAULT_COOKIE_WINDOW_DAYS`, default 60)
- `aff_click` = click id (same window)

## Device detection

`detectDevice(ua)` classifies `mobile` / `tablet` / `desktop` / `bot` and is stored on `Click.deviceType`. No external dependency.

## Pixel / JS snippet

Drop on any landing page (no redirect link needed):

```html
<!-- Image beacon -->
<img src="https://api.example.com/v1/track/pixel.gif?ref=ABAAN001&utm_source=blog" width="1" height="1" alt="" />

<!-- Or JS beacon -->
<script src="https://api.example.com/track.js" data-ref="ABAAN001"></script>
```

A ready snippet is shipped at `web/public/track.js` (posts to `/track/click`).

## Postback (server-to-server)

For advertisers that fire a conversion from their backend:

```bash
curl -X POST https://api.example.com/v1/track/postback \
  -H "x-api-key: aff_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "referralCode": "ABAAN001",
    "externalId": "ORDER-1001",
    "storeId": "<storeId>",
    "amount": 120.50,
    "currency": "USD",
    "customerEmail": "buyer@example.com"
  }'
```

- Requires API key scope `orders.write`.
- Internally calls `orders.ingest`, so attribution, fraud scoring, and commission generation all run.
- Response: `{ ok, orderId, attribution, commission, fraud }`.

## Tests

`src/tracking/tracking.service.spec.ts` — device detection, click (IP hash/device/UTM strip), pixel click, org scoping.

## Local

```bash
npm test -- tracking
```

No new migration (uses existing `Click.deviceType`).
