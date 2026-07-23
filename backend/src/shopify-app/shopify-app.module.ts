import { Module } from '@nestjs/common'
import { StoresModule } from '../stores/stores.module'
import { AuthModule } from '../auth/auth.module'
import { ShopifyAppController } from './shopify-app.controller'
import { ShopifyAppService } from './shopify-app.service'

/**
 * Shopify public-app OAuth install flow. Depends on StoresModule for the
 * idempotent store upsert; inbound webhooks reuse the existing WebhooksModule.
 */
@Module({
  imports: [StoresModule, AuthModule],
  controllers: [ShopifyAppController],
  providers: [ShopifyAppService],
  exports: [ShopifyAppService],
})
export class ShopifyAppModule {}
