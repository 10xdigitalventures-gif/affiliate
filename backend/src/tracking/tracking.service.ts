import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { classifyChannel } from '../common/attribution/channel'

export interface ClickMeta {
  ip?: string
  userAgent?: string
  landingPage?: string
  utm?: Record<string, string | undefined>
  /** Full landing query bag (used to detect ad click-ids like gclid/fbclid/ttclid). */
  params?: Record<string, string | undefined>
  country?: string
}

export interface PostbackInput {
  /** Affiliate referral code or slug (from the aff_ref cookie / click id). */
  referralCode?: string | null
  clickId?: string | null
  /** External order / transaction id from the advertiser. */
  externalId: string
  storeId?: string | null
  amount?: number | null
  currency?: string | null
  couponCode?: string | null
  customerEmail?: string | null
}

/** Very small UA classifier — no external dep. */
export function detectDevice(ua?: string): string | null {
  if (!ua) return null
  const s = ua.toLowerCase()
  if (/(ipad|tablet|playbook|silk)|(android(?!.*mobile))/.test(s)) return 'tablet'
  if (/(mobi|iphone|ipod|blackberry|iemobile|opera mini|windows phone)/.test(s)) return 'mobile'
  if (/(bot|crawl|spider|slurp|bingpreview|facebookexternalhit)/.test(s)) return 'bot'
  return 'desktop'
}

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  private hashIp(ip?: string) {
    if (!ip) return null
    // Normalize x-forwarded-for lists to the first hop.
    const first = ip.split(',')[0].trim()
    return createHash('sha256').update(first).digest('hex')
  }

  /**
   * Records a click for a short code and returns the affiliate + destination.
   * The caller sets the attribution cookie (aff_ref) to the affiliate code.
   */
  async recordClick(shortCode: string, meta: ClickMeta) {
    const link = await this.prisma.affiliateLink.findUnique({
      where: { shortCode },
      include: { affiliate: true },
    })
    if (!link) return null

    const utm = meta.utm
      ? Object.fromEntries(Object.entries(meta.utm).filter(([, v]) => v != null && v !== ''))
      : undefined

    const ch = classifyChannel({ utm: meta.utm, params: meta.params })
    const [click] = await this.prisma.$transaction([
      this.prisma.click.create({
        data: {
          affiliateId: link.affiliateId,
          affiliateLinkId: link.id,
          storeId: link.storeId,
          ipHash: this.hashIp(meta.ip),
          userAgent: meta.userAgent,
          deviceType: detectDevice(meta.userAgent),
          landingPage: meta.landingPage ?? link.destinationUrl,
          utm: utm && Object.keys(utm).length ? utm : undefined,
          channel: ch.channel,
          adNetwork: ch.adNetwork ?? undefined,
          country: meta.country,
        },
      }),
      this.prisma.affiliateLink.update({
        where: { id: link.id },
        data: { clicksCount: { increment: 1 } },
      }),
    ])

    return {
      clickId: click.id,
      affiliateCode: link.affiliate.affiliateCode,
      affiliateId: link.affiliateId,
      destinationUrl: link.destinationUrl,
    }
  }

  /**
   * Pixel / cookieless click beacon: record a raw click for an affiliate code
   * without a short link (used by JS snippet or <img> pixel on landing pages).
   * Returns the click id + affiliate code so the snippet can persist the cookie.
   */
  async recordPixelClick(
    organizationId: string | null,
    referralCode: string,
    meta: ClickMeta,
  ) {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: {
        status: 'approved',
        ...(organizationId ? { organizationId } : {}),
        OR: [{ affiliateCode: referralCode }, { referralSlug: referralCode }],
      },
    })
    if (!affiliate) return null

    const utm = meta.utm
      ? Object.fromEntries(Object.entries(meta.utm).filter(([, v]) => v != null && v !== ''))
      : undefined

    const ch = classifyChannel({ utm: meta.utm, params: meta.params })
    const click = await this.prisma.click.create({
      data: {
        affiliateId: affiliate.id,
        ipHash: this.hashIp(meta.ip),
        userAgent: meta.userAgent,
        deviceType: detectDevice(meta.userAgent),
        landingPage: meta.landingPage,
        utm: utm && Object.keys(utm).length ? utm : undefined,
        channel: ch.channel,
        adNetwork: ch.adNetwork ?? undefined,
        country: meta.country,
      },
    })

    return {
      clickId: click.id,
      affiliateId: affiliate.id,
      affiliateCode: affiliate.affiliateCode,
    }
  }
}
