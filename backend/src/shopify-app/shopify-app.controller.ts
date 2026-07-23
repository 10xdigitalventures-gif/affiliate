import { Controller, Get, Post, Headers, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { setEmbeddedSessionCookies } from '../auth/session-cookies'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { JwtPayload } from '../auth/jwt.strategy'
import { ShopifyAppService } from './shopify-app.service'

/**
 * Shopify public-app OAuth endpoints.
 *
 * Install flow:
 *   1. Dashboard (authenticated) calls GET /v1/shopify/install-url?shop=... ->
 *      receives the Shopify authorize URL and redirects the merchant there.
 *   2. Merchant approves scopes on Shopify.
 *   3. Shopify redirects back to GET /v1/shopify/callback (public) which
 *      verifies HMAC + state, exchanges the token, connects the store, and
 *      auto-registers order/refund/uninstall webhooks.
 */
@ApiTags('integrations')
@Controller('shopify')
export class ShopifyAppController {
  constructor(private readonly shopify: ShopifyAppService) {}

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get the Shopify OAuth install URL for a shop (starts a 1-click connect).' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stores.write')
  @Get('install-url')
  async installUrl(@Req() req: { user: JwtPayload }, @Query('shop') shop: string) {
    const url = await this.shopify.buildInstallUrl(shop, req.user.organizationId)
    return { url, configured: this.shopify.isConfigured() }
  }

  @ApiOperation({ summary: 'Shopify OAuth redirect (public). Completes install and connects the store.' })
  @Get('callback')
  async callback(@Query() query: Record<string, any>, @Res() res: Response) {
    try {
      const result = await this.shopify.handleCallback(query)
      return res.redirect(result.redirectUrl)
    } catch {
      const dashboard = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
      return res.redirect(`${dashboard}/stores?error=shopify_install_failed`)
    }
  }

  @ApiOperation({ summary: 'Embedded app token exchange: Shopify session token -> platform tokens.' })
  @Post('token-exchange')
  async tokenExchange(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (authorization || '').replace(/^Bearer\s+/i, '').trim()
    const result = await this.shopify.exchangeSessionForTokens(token)
    setEmbeddedSessionCookies(res, result)
    return { user: result.user }
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Link the signed-in platform user to a Shopify staff session.' })
  @UseGuards(JwtAuthGuard)
  @Post('link-identity')
  linkIdentity(
    @Req() req: { user: JwtPayload },
    @Headers('x-shopify-session-token') sessionToken?: string,
  ) {
    if (!sessionToken) throw new UnauthorizedException('Shopify session token required')
    return this.shopify.linkSessionIdentity(sessionToken, req.user.organizationId, req.user.sub)
  }
}
