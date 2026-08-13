import { IsArray, IsIn, IsOptional, IsString } from 'class-validator'

export class ConnectStoreDto {
  @IsIn(['shopify', 'woocommerce', 'ghl', 'custom'])
  platform!: 'shopify' | 'woocommerce' | 'ghl' | 'custom'

  @IsString()
  name!: string

  @IsString()
  domain!: string

  // Shopify
  @IsOptional()
  @IsString()
  accessToken?: string

  // WooCommerce
  @IsOptional()
  @IsString()
  consumerKey?: string

  @IsOptional()
  @IsString()
  consumerSecret?: string

  // Webhook signing secret (both platforms)
  @IsOptional()
  @IsString()
  webhookSecret?: string

  @IsOptional()
  @IsArray()
  scopes?: string[]
}
