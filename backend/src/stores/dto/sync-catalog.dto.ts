import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional } from 'class-validator'

/**
 * Bulk catalog sync payload.
 *
 * - `products` holds either raw platform payloads (Shopify/Woo/GHL product
 *   objects) or already-normalised products.
 * - Set `normalized: true` when the caller has already mapped products into the
 *   NormalizedProduct shape ({ externalId, name, price, sku?, categoryName?,
 *   status? }). When false/omitted, the store's platform mapper is applied.
 */
export class SyncCatalogDto {
  @IsArray()
  @ArrayMaxSize(1_000)
  @IsObject({ each: true })
  products!: Array<Record<string, unknown>>

  @IsOptional()
  @IsBoolean()
  normalized?: boolean
}
