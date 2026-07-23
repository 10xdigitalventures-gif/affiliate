import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger'
import { ApiKeyGuard } from '../common/guards/apikey.guard'
import { StoresService } from './stores.service'
import { RegisterStoreDto } from '../integrations/dto/register-store.dto'

type ApiKeyUser = { organizationId: string; scopes: string[] }

/**
 * Machine-to-machine store registration used by the WooCommerce plugin and
 * custom-store integrations. Authenticated with x-api-key (scope stores.write).
 * Idempotent per (org, platform, domain), so re-running the plugin setup just
 * refreshes the existing store instead of creating duplicates.
 */
@ApiTags('integrations')
@ApiSecurity('apiKey')
@Controller('integrations')
export class StoreRegisterController {
  constructor(private readonly stores: StoresService) {}

  private assertScope(req: { user: ApiKeyUser }) {
    if (!req.user.scopes.includes('stores.write')) {
      throw new ForbiddenException('API key missing stores.write scope')
    }
  }

  private ingestEndpoints() {
    const base = (process.env.SHOPIFY_APP_URL || process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '')
    const prefix = process.env.API_PREFIX || 'v1'
    return {
      ingestUrl: `${base}/${prefix}/orders/ingest/apikey`,
      refundUrl: `${base}/${prefix}/orders/refund/apikey`,
    }
  }

  @ApiOperation({ summary: 'Register/refresh a WooCommerce store (plugin self-connect). Requires stores.write.' })
  @UseGuards(ApiKeyGuard)
  @Post('woocommerce/register')
  async registerWoo(@Req() req: { user: ApiKeyUser }, @Body() dto: RegisterStoreDto) {
    this.assertScope(req)
    const store = await this.stores.upsertConnected(req.user.organizationId, {
      platform: 'woocommerce',
      name: dto.name,
      domain: dto.domain,
      webhookSecret: dto.webhookSecret,
    })
    return { storeId: store.id, platform: store.platform, ...this.ingestEndpoints() }
  }

  @ApiOperation({ summary: 'Register/refresh a custom store (generic API integration). Requires stores.write.' })
  @UseGuards(ApiKeyGuard)
  @Post('custom/register')
  async registerCustom(@Req() req: { user: ApiKeyUser }, @Body() dto: RegisterStoreDto) {
    this.assertScope(req)
    const store = await this.stores.upsertConnected(req.user.organizationId, {
      platform: 'custom',
      name: dto.name,
      domain: dto.domain,
      webhookSecret: dto.webhookSecret,
    })
    return { storeId: store.id, platform: store.platform, ...this.ingestEndpoints() }
  }
}
