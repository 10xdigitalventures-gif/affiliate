# Multi-Tier / Sub-Affiliate Commissions

Reward affiliates a percentage of the commissions earned by affiliates they
recruit (their "downline"). Off by default; enable per-org in Settings →
Multi-tier commissions.

## Data model

- `Affiliate.parentAffiliateId` — self-relation to the recruiter (`parent` / `subAffiliates`).
- `Commission.tier` — `0` = direct sale, `1+` = override earned from a downline.
- `Commission.sourceCommissionId` — the direct commission an override was derived from (`source` / `overrides`).

Migration: `prisma/migrations/20260710_multi_tier_affiliates/migration.sql`.

## Config (org.settings JSON)

| Key | Default | Meaning |
|---|---|---|
| `subAffiliateEnabled` | `false` | Master switch |
| `subAffiliateRate` | `10` | % of the downline's **direct** commission paid up |
| `subAffiliateMaxDepth` | `1` | How many tiers up to reward |
| `subAffiliateDecay` | `1` | Rate multiplier per tier (1 = flat, 0.5 = halve each level) |

Managed via `GET/PATCH /v1/settings/sub-affiliate`.

## How overrides are generated

When a **direct** commission is created (`generateForOrder`), the engine walks
up the recruiter chain via `generateOverrides()`:

```
overrideAmount(tier) = directAmount * (rate% * decay^(tier-1))
```

- Stops at the top of the chain or once `maxDepth` is reached.
- **Cycle-guarded** (a `seen` set prevents infinite loops).
- Only **approved** parents are rewarded; inactive parents are skipped but the walk continues.
- Override creation is best-effort — a failure never blocks the direct commission (it's audited).

Example: rate 10%, depth 3, decay 0.5, direct commission = $20
- Tier 1 recruiter: $2.00
- Tier 2: $1.00
- Tier 3: $0.50

## Reversals & refunds cascade

- `reverse()` → also reverses every override linked via `sourceCommissionId`.
- `handleRefund()` → applies the same proportional ratio to each override, then
  reverses (full) or records a `partial_refund` adjustment. Overrides are skipped
  in the main loop and handled alongside their source so they aren't double-counted.

## Managing the hierarchy

- `PATCH /v1/affiliates/:id/parent { parentAffiliateId }` — set/clear recruiter.
  Guards against self-parenting and upline cycles.
- `GET /v1/affiliates/:id/downline` — direct sub-affiliates + total override earnings.

## Tests

`src/commissions/multi-tier.service.spec.ts` covers: disabled no-op, single-parent
rate, multi-tier decay, top-of-chain stop, and skipping non-approved parents.
