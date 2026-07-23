# Real Payout Automation

Automated affiliate payouts via pluggable providers. Any method without
configured credentials falls back to **manual** settlement (no money moves; an
admin settles by hand).

## Providers

| Method | Provider | Rail | Destination field (on affiliate payout method) |
|---|---|---|---|
| `stripe` | `StripePayoutProvider` | Stripe Connect **Transfers** | `stripeAccountId` (`acct_...`) |
| `wise` | `WisePayoutProvider` | Wise quote → transfer → fund | `wiseRecipientId` |
| `bank` / `paypal` / `crypto` / `manual` | `ManualPayoutProvider` | none | — |

All providers implement `PayoutProvider` (`src/payouts/providers/payout-provider.interface.ts`)
and are dispatched by `PayoutProviderService.forMethod(method)`.

## Lifecycle

```
requested ──approve──> approved ──process──> processing ──> paid | failed
                                   └─ manual mark-paid ──> paid
```

- `POST /v1/payouts/:id/process` — sends an **approved** payout via its provider.
  - Provider returns **paid** → commissions marked paid, affiliate balance decremented, "payout sent" email fired (shared `settlePaid`).
  - Provider returns **processing** (async rails like Wise, or manual) → payout stays `processing`, provider reference stored for reconciliation.
  - Provider returns **failed** → payout → `failed`, error audited, `400` returned.
- `PATCH /v1/payouts/:id/mark-paid` — manual settlement; now accepts **approved OR processing**.

The payout is locked to `processing` before the provider call, so retries never double-send.
Stripe uses `idempotencyKey = payout_<id>` and Wise uses `customerTransactionId = payout_<id>`.

## Destination details

Each affiliate stores encrypted destination details on their `PayoutMethodRecord`
(`detailsEnc`, AES-256-GCM via `CryptoService`). `resolveDestination()` picks the
default record for the payout method and decrypts it before dispatch.

## Configuration

See `.env.payouts.example`:

```
STRIPE_SECRET_KEY=""          # method=stripe
WISE_API_TOKEN=""            # method=wise
WISE_PROFILE_ID=""
WISE_API_BASE="https://api.wise.com"   # sandbox: https://api.sandbox.transferwise.tech
```

- `stripe` npm dep added to `package.json` (loaded lazily so boot never breaks when unset).
- Wise uses global `fetch` (Node 18+) — no extra dependency.
- `isConfigured()` gates each provider; unconfigured automated methods report a clear error.

## Admin UI

Payouts table (`/payouts`) now shows **Process** on approved rows, **Mark paid**
on approved/processing rows, and a new **Processing** filter tab.
