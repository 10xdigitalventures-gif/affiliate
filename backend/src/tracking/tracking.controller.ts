import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { IsNumber, IsOptional, IsString } from 'class-validator'
import { ApiKeyGuard } from '../common/guards/apikey.guard'
import { TrackingService } from './tracking.service'
import { OrdersService } from '../orders/orders.service'
import { classifyChannel } from '../common/attribution/channel'

const COOKIE_NAME = 'aff_ref'
const CLICK_COOKIE = 'aff_click'
const CHANNEL_COOKIE = 'aff_channel'

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

class PostbackDto {
  @IsOptional() @IsString() referralCode?: string
  @IsOptional() @IsString() clickId?: string
  @IsString() externalId!: string
  @IsOptional() @IsString() storeId?: string
  @IsOptional() @IsNumber() amount?: number
  @IsOptional() @IsString() currency?: string
  @IsOptional() @IsString() couponCode?: string
  @IsOptional() @IsString() customerEmail?: string
  @IsOptional() @IsString() channel?: 'paid' | 'organic' | string
  @IsOptional() @IsString() adNetwork?: string
  @IsOptional() @IsString() attributionType?: 'link' | 'code' | string
}

function clientIp(req: Request): string | undefined {
  return (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined
}

function utmFromQuery(q: Record<string, string>) {
  return {
    source: q.utm_source,
    medium: q.utm_medium,
    campaign: q.utm_campaign,
    term: q.utm_term,
    content: q.utm_content,
  }
}

@ApiTags('tracking')
@Controller('track')
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly orders: OrdersService,
  ) {}

  private windowMs() {
    const days = Number(process.env.DEFAULT_COOKIE_WINDOW_DAYS) || 60
    return days * 24 * 60 * 60 * 1000
  }

  private setAttributionCookies(
    res: Response,
    affiliateCode: string,
    clickId?: string,
    channel?: { channel: string; adNetwork?: string },
  ) {
    const maxAge = this.windowMs()
    res.cookie(COOKIE_NAME, affiliateCode, { maxAge, httpOnly: false, sameSite: 'lax' })
    if (clickId) res.cookie(CLICK_COOKIE, clickId, { maxAge, httpOnly: false, sameSite: 'lax' })
    if (channel) {
      res.cookie(CHANNEL_COOKIE, channel.channel, { maxAge, httpOnly: false, sameSite: 'lax' })
      if (channel.adNetwork) res.cookie('aff_adnet', channel.adNetwork, { maxAge, httpOnly: false, sameSite: 'lax' })
    }
  }

  /**
   * Public redirect: /v1/track/r/:shortCode
   * Records the click, sets last-click cookies, redirects to destination.
   */
  @Get('r/:shortCode')
  async redirect(
    @Param('shortCode') shortCode: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const ch = classifyChannel({ utm: utmFromQuery(query), params: query })
    const result = await this.tracking.recordClick(shortCode, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      landingPage: query.u,
      utm: utmFromQuery(query),
      params: query,
    })

    if (!result) {
      res.status(404).send('Invalid link')
      return
    }

    this.setAttributionCookies(res, result.affiliateCode, result.clickId, { channel: ch.channel, adNetwork: ch.adNetwork })
    res.redirect(302, result.destinationUrl)
  }

  /**
   * Tracking pixel: /v1/track/pixel.gif?ref=CODE
   * Records a cookieless click and returns a 1x1 GIF. For <img> beacons on
   * landing pages where a redirect link isn't used.
   */
  @Get('pixel.gif')
  async pixel(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const ref = query.ref || query.aff
    if (ref) {
      const ch = classifyChannel({ utm: utmFromQuery(query), params: query })
      const result = await this.tracking.recordPixelClick(query.org ?? null, ref, {
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        landingPage: query.u || (req.headers['referer'] as string),
        utm: utmFromQuery(query),
        params: query,
      }).catch(() => null)
      if (result) this.setAttributionCookies(res, result.affiliateCode, result.clickId, { channel: ch.channel, adNetwork: ch.adNetwork })
    }
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    })
    res.status(200).send(PIXEL)
  }

  /**
   * JSON click beacon (JS snippet): POST /v1/track/click { ref, u, utm_* }
   * Returns the click id + affiliate code so the snippet can set its own cookie.
   */
  @Post('click')
  async click(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { ref?: string; org?: string; u?: string } & Record<string, string>,
  ) {
    if (!body.ref) return { ok: false }
    const ch = classifyChannel({ utm: utmFromQuery(body), params: body })
    const result = await this.tracking.recordPixelClick(body.org ?? null, body.ref, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      landingPage: body.u || (req.headers['referer'] as string),
      utm: utmFromQuery(body),
      params: body,
    })
    if (!result) return { ok: false }
    this.setAttributionCookies(res, result.affiliateCode, result.clickId, { channel: ch.channel, adNetwork: ch.adNetwork })
    return { ok: true, clickId: result.clickId, affiliateCode: result.affiliateCode }
  }

  /**
   * Server-to-server conversion postback (API key auth).
   * POST /v1/track/postback  Header: x-api-key: aff_live_<key>
   * Maps to a normalised order ingest so attribution + fraud + commissions run.
   * Required scope: orders.write
   */
  @ApiOperation({ summary: 'S2S conversion postback (API key). Requires orders.write scope.' })
  @ApiSecurity('apiKey')
  @Post('postback')
  @UseGuards(ApiKeyGuard)
  async postback(
    @Req() req: { user: { organizationId: string; scopes: string[] } },
    @Body() dto: PostbackDto,
  ) {
    if (!req.user.scopes.includes('orders.write')) {
      throw new (require('@nestjs/common').ForbiddenException)('API key missing orders.write scope')
    }
    const amount = typeof dto.amount === 'number' ? dto.amount : 0
    const result = await this.orders.ingest(req.user.organizationId, {
      storeId: dto.storeId ?? '',
      externalOrderId: dto.externalId,
      subtotal: amount,
      total: amount,
      currency: dto.currency ?? 'USD',
      status: 'paid',
      customerEmail: dto.customerEmail,
      couponCode: dto.couponCode,
      referralCode: dto.referralCode ?? undefined,
      channel: dto.channel === 'paid' ? 'paid' : dto.channel === 'organic' ? 'organic' : undefined,
      adNetwork: dto.adNetwork,
      attributionType: dto.attributionType === 'code' ? 'code' : dto.attributionType === 'link' ? 'link' : undefined,
    } as any)
    return {
      ok: true,
      orderId: (result as any)?.order?.id,
      attribution: (result as any)?.attribution?.method ?? null,
      commission: (result as any)?.commission?.id ?? null,
      fraud: (result as any)?.fraud?.decision ?? null,
    }
  }
}
