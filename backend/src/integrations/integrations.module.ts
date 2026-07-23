import { Module } from '@nestjs/common'
import { ShopifyService } from './shopify.service'
import { WooCommerceService } from './woocommerce.service'
import { GhlService } from './ghl.service'

@Module({
  providers: [ShopifyService, WooCommerceService, GhlService],
  exports: [ShopifyService, WooCommerceService, GhlService],
})
export class IntegrationsModule {}
