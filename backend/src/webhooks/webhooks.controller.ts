import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { WebhooksService } from './webhooks.service'

/**
 * Public inbound webhook endpoints. Signature is verified from the RAW body,
 * so global JSON parsing must not mutate it (rawBody is enabled in main.ts).
 * Always responds 200 quickly; processing is idempotent.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('shopify/:storeId')
  @HttpCode(200)
  shopify(@Param('storeId') storeId: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.handleShopify(storeId, req.headers, req.rawBody ?? Buffer.from(''))
  }

  @Post('woocommerce/:storeId')
  @HttpCode(200)
  woocommerce(@Param('storeId') storeId: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.handleWoo(storeId, req.headers, req.rawBody ?? Buffer.from(''))
  }

  @Post('ghl/:storeId')
  @HttpCode(200)
  ghl(@Param('storeId') storeId: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.handleGhl(storeId, req.headers, req.rawBody ?? Buffer.from(''))
  }
}
