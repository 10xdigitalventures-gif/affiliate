# Bulk CSV Import / Export

Dependency-free CSV import & export. Backend module: `src/bulk/`.

## Endpoints (JWT + permissions)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/v1/bulk/export/:entity` | `reports.read` | Download `affiliates` \| `commissions` \| `orders` \| `payouts` as CSV |
| GET | `/v1/bulk/template/affiliates` | `affiliates.read` | Download a ready-to-fill affiliates CSV template |
| POST | `/v1/bulk/import/affiliates` | `affiliates.write` | Bulk-create affiliates from CSV |

Exports cap at 10,000 rows per entity.

## Import: affiliates

Body: `{ "csv": "<raw csv text>" }`

Columns:

| Column | Required | Notes |
|---|---|---|
| `affiliateCode` | ✅ | Unique per org; existing codes are **skipped** (not errored) |
| `referralSlug` | | Defaults to lowercased code |
| `status` | | `pending` (default) / `approved` / `suspended` / `rejected` |
| `parentAffiliateCode` | | Links recruiter for multi-tier; resolved after all rows so forward references work |

Response:

```json
{ "total": 10, "created": 8, "skipped": 1, "errors": [{ "row": 5, "message": "Invalid status \"foo\"" }] }
```

- Row numbers are 1-based including the header (so first data row = 2).
- Parent linkage is applied after creation; self-links and unknown parents are ignored.

## CSV util (`src/bulk/csv.util.ts`)

- `buildCsv(header, rows)` — RFC-4180-ish; quotes fields containing `, " \n \r`.
- `parseCsv(text)` — handles quoted fields, escaped `""`, embedded commas/newlines, CRLF, and blank lines.
- Tested in `src/bulk/csv.util.spec.ts` (build/parse round-trip, quoting, CRLF, empties).

## Web UI

Settings → **Bulk import / export**:
- One-click CSV export for each entity (uses an authenticated blob download).
- Affiliate import via file picker or paste, with a template link and a per-row error report.
