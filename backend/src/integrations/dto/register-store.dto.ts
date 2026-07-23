import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Self-registration payload sent by the WooCommerce plugin or a custom store
 * integration (authenticated with an API key). Creates/updates a Store and
 * returns its id + the ingest endpoints the caller should post orders to.
 */
export class RegisterStoreDto {
  @IsString()
  @MaxLength(120)
  name!: string

  @IsString()
  @MaxLength(255)
  domain!: string

  /** Optional signing secret the caller will use for its own webhook posts. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  webhookSecret?: string

  /** Optional platform/plugin version string for diagnostics. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  platformVersion?: string
}
