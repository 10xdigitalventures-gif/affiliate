import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class ConnectStoreDto {
  @IsIn(['shopify', 'woocommerce', 'ghl', 'custom'])
  platform!: 'shopify' | 'woocommerce' | 'ghl' | 'custom'

  @IsString()
  @MaxLength(120)
  name!: string

  @IsString()
  @MaxLength(255)
  domain!: string

  // Shopify
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  accessToken?: string

  // WooCommerce
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  consumerKey?: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  consumerSecret?: string

  // Webhook signing secret (both platforms)
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  webhookSecret?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  scopes?: string[]
}
