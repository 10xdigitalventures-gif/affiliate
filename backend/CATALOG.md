# Product Catalog

Stores now carry a **product catalog** (products + categories) so commissions can
be scoped to individual products/categories (see commission rules) and reports
can break down performance by product/category.

## Data model

- **Product** — `{ storeId, externalId, sku?, name, categoryId?, price, status }`, unique on `(storeId, externalId)`.
- **Category** — org-scoped `{ organizationId, name, externalId? }`. Categories are find-or-created by name during sync.
- **SyncJob** — one row per catalog sync (`jobType: 'catalog'`, status `running → success | failed`).

## Endpoints (`/v1/catalog`, JWT + permissions)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/catalog/products` | `stores.read` | Paginated list; filters `storeId`, `categoryId`, `status`, `search`, `skip`, `take` |
| GET | `/catalog/products/:id` | `stores.read` | Single product (with category + store) |
| GET | `/catalog/categories` | `stores.read` | Org categories (A–Z) |
| GET | `/catalog/stats` | `stores.read` | `{ total, active, inactive, categories, stores }` |
| POST | `/catalog/products` | `stores.write` | Manual create/update one product |
| POST | `/catalog/stores/:id/sync` | `stores.write` | Bulk sync a store's catalog |

## Sync

`POST /catalog/stores/:id/sync` body:

```json
{
  "products": [ /* raw platform product objects OR normalized products */ ],
  "normalized": false
}
```

- When `normalized` is false/omitted, the store's **platform mapper** is applied
  (`ShopifyService.mapProduct` / `WooCommerceService.mapProduct` / `GhlService.mapProduct`).
- When `normalized: true`, products are used as-is in the `NormalizedProduct` shape:
  `{ externalId, name, price, sku?, categoryName?, categoryExternalId?, status? }`.
- Products are upserted by `(storeId, externalId)`; categories are find-or-created by name.
- Returns `{ storeId, jobId, total, created, updated, skipped }`. Rows missing
  `externalId` or `name` are skipped (not fatal). On error the SyncJob is marked `failed`.

### Platform mapping notes

- **Shopify** — first variant's `price`/`sku`; `product_type` → category; `status==='active'` (or `published_at`) → active.
- **WooCommerce** — `price`/`regular_price`; first `categories[]` entry (name + id); `status==='publish'` → active.
- **GHL** — `amount`/`price`; `category`/`collection` → category; `availableInStore`/`active` → active.

> Fetching products from the live platform API (HTTP) is done by the caller/worker;
> this service handles mapping + persistence. In the sandbox there is no network,
> so sync is exercised by passing product payloads directly.

## Dashboard

`/catalog` page: stat cards, store/category/status/search filters, product table,
and a manual "Add product" form. Sync per store from the Stores page action.

## Sandbox note

Tests run only locally: `npm test -- catalog`. No new migration is required (the
`Product`, `Category`, and `SyncJob` models already exist in the schema).
