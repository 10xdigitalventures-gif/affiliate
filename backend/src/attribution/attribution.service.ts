import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CouponsService } from '../coupons/coupons.service'
import { DEFAULT_COUPON_SITES, matchBlockedReferrer } from '../common/attribution/coupon-leak'

export type AttributionMethod = 'coupon' | 'cookie' | 'lifetime' | 'manual'

/** Cookie / multi-touch model applied when method is cookie (or multi-touch path). */
export type CookieModel = 'last_click' | 'first_click' | 'linear' | 'position'

export type CouponProtectionMode = 'off' | 'flag' | 'block'

export interface CouponProtection {
  /** off = no checks, flag = attribute but route to review, block = suppress coupon credit. */
  mode: CouponProtectionMode
  /** Only credit a coupon when the coupon's affiliate also drove a click. */
  requireClickSupport: boolean
  /** Extra coupon/deal-site domains to treat as leaks (merged with the built-in list). */
  blockedReferrers: string[]
}

export interface AttributionSettings {
  cookieModel: CookieModel
  cookieWindowDays: number
  /** When true (default), a coupon with an affiliate wins over cookie/lifetime. */
  couponPriority: boolean
  lifetimeEnabled: boolean
  couponProtection: CouponProtection
}

export type AttributionSettingsPatch = Partial<Omit<AttributionSettings, 'couponProtection'>> & {
  couponProtection?: Partial<CouponProtection>
}

export interface AttributionShare {
  affiliateId: string
  weight: number
  clickId?: string | null
  role: 'first' | 'middle' | 'last' | 'only' | 'coupon' | 'lifetime'
}

export interface AttributionInput {
  storeId: string
  couponCode?: string | null
  referralCode?: string | null // from aff_ref cookie
  customerId?: string | null
  clickId?: string | null
  ipHash?: string | null
  referrer?: string | null // order/landing referrer, used for coupon-leak detection
}

export interface AttributionResult {
  /** Primary affiliate (highest weight; last-click / first-click winner; coupon/lifetime). */
  affiliateId: string
  couponId?: string | null
  clickId?: string | null
  method: AttributionMethod
  model: CookieModel | 'coupon' | 'lifetime' | 'manual'
  /** Credit shares summing to ~1. Always at least one entry for the primary affiliate. */
  shares: AttributionShare[]
  /** Present when anti-leak protection suspects a leaked coupon conversion. */
  couponLeak?: { suspected: boolean; reason: string }
}

const DEFAULTS: AttributionSettings = {
  cookieModel: 'last_click',
  cookieWindowDays: Number(process.env.DEFAULT_COOKIE_WINDOW_DAYS) || 60,
  couponPriority: true,
  lifetimeEnabled: true,
  couponProtection: { mode: 'flag', requireClickSupport: false, blockedReferrers: [] },
}

const VALID_MODELS: CookieModel[] = ['last_click', 'first_click', 'linear', 'position']

/**
 * Resolves which affiliate(s) an order should be attributed to.
 *
 * Priority (when couponPriority=true): coupon > cookie path > lifetime.
 * Cookie path supports last-click, first-click, linear, and position-based multi-touch.
 */
@Injectable()
export class AttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
  ) {}

  async getSettings(organizationId: string): Promise<AttributionSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!org) throw new NotFoundException('Organization not found')
    const s = (org.settings ?? {}) as Record<string, unknown>
    const rawModel = typeof s.cookieModel === 'string' ? s.cookieModel : DEFAULTS.cookieModel
    const cp = (s.couponProtection ?? {}) as Record<string, unknown>
    const cpMode: CouponProtectionMode = cp.mode === 'off' || cp.mode === 'block' ? cp.mode : 'flag'
    return {
      cookieModel: (VALID_MODELS as string[]).includes(rawModel) ? (rawModel as CookieModel) : DEFAULTS.cookieModel,
      cookieWindowDays:
        typeof s.cookieWindowDays === 'number' && s.cookieWindowDays > 0
          ? s.cookieWindowDays
          : DEFAULTS.cookieWindowDays,
      couponPriority: s.couponPriority === false ? false : DEFAULTS.couponPriority,
      lifetimeEnabled: s.lifetimeEnabled === false ? false : DEFAULTS.lifetimeEnabled,
      couponProtection: {
        mode: cpMode,
        requireClickSupport: cp.requireClickSupport === true,
        blockedReferrers: Array.isArray(cp.blockedReferrers)
          ? (cp.blockedReferrers as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
      },
    }
  }

  async updateSettings(
    organizationId: string,
    patch: AttributionSettingsPatch,
  ): Promise<AttributionSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!org) throw new NotFoundException('Organization not found')
    if (patch.cookieModel !== undefined && !VALID_MODELS.includes(patch.cookieModel)) {
      throw new BadRequestException(`cookieModel must be one of: ${VALID_MODELS.join(', ')}`)
    }
    if (patch.cookieWindowDays !== undefined && (!(patch.cookieWindowDays > 0) || patch.cookieWindowDays > 3650)) {
      throw new BadRequestException('cookieWindowDays must be between 1 and 3650')
    }
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prev = await this.getSettings(organizationId)
    const next: AttributionSettings = {
      cookieModel: patch.cookieModel ?? prev.cookieModel,
      cookieWindowDays: patch.cookieWindowDays ?? prev.cookieWindowDays,
      couponPriority: patch.couponPriority ?? prev.couponPriority,
      lifetimeEnabled: patch.lifetimeEnabled ?? prev.lifetimeEnabled,
      couponProtection: {
        mode: patch.couponProtection?.mode ?? prev.couponProtection.mode,
        requireClickSupport:
          patch.couponProtection?.requireClickSupport ?? prev.couponProtection.requireClickSupport,
        blockedReferrers: patch.couponProtection?.blockedReferrers ?? prev.couponProtection.blockedReferrers,
      },
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: {
          ...current,
          cookieModel: next.cookieModel,
          cookieWindowDays: next.cookieWindowDays,
          couponPriority: next.couponPriority,
          lifetimeEnabled: next.lifetimeEnabled,
          couponProtection: next.couponProtection,
        } as any,
      },
    })
    return next
  }

  async resolve(organizationId: string, input: AttributionInput): Promise<AttributionResult | null> {
    const settings = await this.getSettings(organizationId)

    // 1) Coupon attribution (with anti-leak protection)
    if (input.couponCode) {
      const coupon = await this.coupons.findByCode(input.storeId, input.couponCode)
      if (coupon?.affiliateId) {
        if (settings.couponPriority) {
          const leak = await this.evaluateCouponLeak(organizationId, coupon.affiliateId, input, settings)
          if (!(leak.leaked && settings.couponProtection.mode === 'block')) {
            return {
              affiliateId: coupon.affiliateId,
              couponId: coupon.id,
              method: 'coupon',
              model: 'coupon',
              shares: [{ affiliateId: coupon.affiliateId, weight: 1, role: 'coupon' }],
              couponLeak: leak.leaked ? { suspected: true, reason: leak.reason! } : undefined,
            }
          }
          // Leaked + block mode: suppress coupon credit, fall through to cookie/lifetime.
        }
        // couponPriority=false: fall through to cookie/lifetime, but keep coupon as fallback later
      }
    }

    // 2) Cookie / multi-touch path
    const cookieResult = await this.resolveCookiePath(organizationId, input, settings)
    if (cookieResult) return cookieResult

    // Coupon without priority (if we skipped it above)
    if (input.couponCode && !settings.couponPriority) {
      const coupon = await this.coupons.findByCode(input.storeId, input.couponCode)
      if (coupon?.affiliateId) {
        const leak = await this.evaluateCouponLeak(organizationId, coupon.affiliateId, input, settings)
        if (!(leak.leaked && settings.couponProtection.mode === 'block')) {
          return {
            affiliateId: coupon.affiliateId,
            couponId: coupon.id,
            method: 'coupon',
            model: 'coupon',
            shares: [{ affiliateId: coupon.affiliateId, weight: 1, role: 'coupon' }],
            couponLeak: leak.leaked ? { suspected: true, reason: leak.reason! } : undefined,
          }
        }
      }
    }

    // 3) Lifetime
    if (settings.lifetimeEnabled && input.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: input.customerId, organizationId },
      })
      if (customer?.firstAffiliateId) {
        return {
          affiliateId: customer.firstAffiliateId,
          method: 'lifetime',
          model: 'lifetime',
          shares: [{ affiliateId: customer.firstAffiliateId, weight: 1, role: 'lifetime' }],
        }
      }
    }

    return null
  }

  /** Decide whether a coupon conversion most likely leaked (deal-site referrer / no click). */
  private async evaluateCouponLeak(
    organizationId: string,
    couponAffiliateId: string,
    input: AttributionInput,
    settings: AttributionSettings,
  ): Promise<{ leaked: boolean; reason?: string }> {
    const cp = settings.couponProtection
    if (cp.mode === 'off') return { leaked: false }

    const blocked = [...DEFAULT_COUPON_SITES, ...cp.blockedReferrers]
    const matched = matchBlockedReferrer(input.referrer, blocked)
    if (matched) return { leaked: true, reason: `referrer is a known coupon/deal site (${matched})` }

    if (cp.requireClickSupport) {
      const since = new Date(Date.now() - settings.cookieWindowDays * 24 * 60 * 60 * 1000)
      const supported = await this.hasSupportingClick(organizationId, couponAffiliateId, input, since)
      if (!supported) return { leaked: true, reason: 'coupon used without a supporting affiliate click' }
    }
    return { leaked: false }
  }

  /** True when the coupon's affiliate also drove a click (session, referral cookie, or recent window). */
  private async hasSupportingClick(
    organizationId: string,
    affiliateId: string,
    input: AttributionInput,
    since: Date,
  ): Promise<boolean> {
    if (input.clickId) {
      const c = await this.prisma.click.findFirst({
        where: { id: input.clickId, affiliate: { organizationId } },
      })
      if (c && c.affiliateId === affiliateId && c.occurredAt >= since) return true
    }
    if (input.referralCode) {
      const referral = input.referralCode.trim()
      const aff = await this.prisma.affiliate.findFirst({
        where: {
          id: affiliateId,
          organizationId,
          OR: [
            { affiliateCode: referral.toUpperCase() },
            { referralSlug: referral.toLowerCase() },
          ],
        },
      })
      if (aff) return true
    }
    const any = await this.prisma.click.findFirst({
      where: { affiliateId, occurredAt: { gte: since }, affiliate: { organizationId } },
    })
    return !!any
  }

  private async resolveCookiePath(
    organizationId: string,
    input: AttributionInput,
    settings: AttributionSettings,
  ): Promise<AttributionResult | null> {
    if (!input.referralCode && !input.clickId && !input.ipHash) return null

    const since = new Date(Date.now() - settings.cookieWindowDays * 24 * 60 * 60 * 1000)

    // Resolve seed affiliate from referral cookie when present
    let seedAffiliateId: string | null = null
    if (input.referralCode) {
      const referral = input.referralCode.trim()
      if (referral.length < 1 || referral.length > 64) return null
      const affiliate = await this.prisma.affiliate.findFirst({
        where: {
          organizationId,
          status: 'approved',
          OR: [
            { affiliateCode: referral.toUpperCase() },
            { referralSlug: referral.toLowerCase() },
          ],
        },
      })
      if (!affiliate) return null
      seedAffiliateId = affiliate.id
    }

    // Build ordered unique touch path from clicks in window
    const path = await this.buildTouchPath({
      organizationId,
      seedAffiliateId,
      since,
      clickId: input.clickId,
      ipHash: input.ipHash,
    })

    if (path.length === 0) {
      // Referral code present but no clicks in window — still credit that affiliate (legacy behaviour)
      if (seedAffiliateId) {
        return singleCookie(seedAffiliateId, null, settings.cookieModel)
      }
      return null
    }

    const shares = weightPath(path, settings.cookieModel)
    const primary = pickPrimary(shares, settings.cookieModel, path)
    return {
      affiliateId: primary.affiliateId,
      clickId: primary.clickId ?? null,
      method: 'cookie',
      model: settings.cookieModel,
      shares,
    }
  }

  private async buildTouchPath(args: {
    organizationId: string
    seedAffiliateId: string | null
    since: Date
    clickId?: string | null
    ipHash?: string | null
  }): Promise<Array<{ affiliateId: string; clickId: string; occurredAt: Date }>> {
    const { organizationId, seedAffiliateId, since, clickId, ipHash } = args

    // Prefer explicit click → its ipHash; else input ipHash; else last click of seed affiliate
    let sessionIp: string | null = ipHash ?? null
    if (clickId) {
      const c = await this.prisma.click.findFirst({
        where: { id: clickId, affiliate: { organizationId } },
      })
      if (c && c.occurredAt >= since) {
        sessionIp = c.ipHash ?? sessionIp
      }
    }

    if (!sessionIp && seedAffiliateId) {
      const last = await this.prisma.click.findFirst({
        where: {
          affiliateId: seedAffiliateId,
          occurredAt: { gte: since },
          affiliate: { organizationId },
        },
        orderBy: { occurredAt: 'desc' },
      })
      sessionIp = last?.ipHash ?? null
      if (!sessionIp && last) {
        // No IP stitching possible — single touch from seed affiliate's last click
        return [{ affiliateId: seedAffiliateId, clickId: last.id, occurredAt: last.occurredAt }]
      }
      if (!last) return []
    }

    if (!sessionIp) {
      if (seedAffiliateId) {
        // No clicks at all
        return []
      }
      return []
    }

    // All clicks in window with this IP, limited to org affiliates
    const clicks = await this.prisma.click.findMany({
      where: {
        ipHash: sessionIp,
        occurredAt: { gte: since },
        affiliate: { organizationId, status: 'approved' },
      },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, affiliateId: true, occurredAt: true },
      take: 200,
    })

    // Unique affiliates in first-seen order (path)
    const seen = new Set<string>()
    const path: Array<{ affiliateId: string; clickId: string; occurredAt: Date }> = []
    for (const c of clicks) {
      if (seen.has(c.affiliateId)) continue
      seen.add(c.affiliateId)
      path.push({ affiliateId: c.affiliateId, clickId: c.id, occurredAt: c.occurredAt })
    }

    // If seed affiliate never appeared (edge), prepend/append nothing — path is IP truth
    // But if path empty and we have seed, fall back
    if (path.length === 0 && seedAffiliateId) {
      const last = await this.prisma.click.findFirst({
        where: {
          affiliateId: seedAffiliateId,
          occurredAt: { gte: since },
          affiliate: { organizationId },
        },
        orderBy: { occurredAt: 'desc' },
      })
      if (last) path.push({ affiliateId: seedAffiliateId, clickId: last.id, occurredAt: last.occurredAt })
    }

    return path
  }
}

function singleCookie(
  affiliateId: string,
  clickId: string | null,
  model: CookieModel,
): AttributionResult {
  return {
    affiliateId,
    clickId,
    method: 'cookie',
    model,
    shares: [{ affiliateId, weight: 1, clickId, role: 'only' }],
  }
}

function weightPath(
  path: Array<{ affiliateId: string; clickId: string }>,
  model: CookieModel,
): AttributionShare[] {
  const n = path.length
  if (n === 0) return []
  if (n === 1) {
    return [{ affiliateId: path[0].affiliateId, weight: 1, clickId: path[0].clickId, role: 'only' }]
  }

  if (model === 'last_click') {
    const last = path[n - 1]
    return [{ affiliateId: last.affiliateId, weight: 1, clickId: last.clickId, role: 'last' }]
  }
  if (model === 'first_click') {
    const first = path[0]
    return [{ affiliateId: first.affiliateId, weight: 1, clickId: first.clickId, role: 'first' }]
  }
  if (model === 'linear') {
    const w = 1 / n
    return path.map((p, i) => ({
      affiliateId: p.affiliateId,
      weight: w,
      clickId: p.clickId,
      role: i === 0 ? 'first' : i === n - 1 ? 'last' : 'middle',
    }))
  }
  // position: 40% first, 40% last, 20% middle split (if no middle, 50/50)
  if (n === 2) {
    return [
      { affiliateId: path[0].affiliateId, weight: 0.5, clickId: path[0].clickId, role: 'first' },
      { affiliateId: path[1].affiliateId, weight: 0.5, clickId: path[1].clickId, role: 'last' },
    ]
  }
  const midCount = n - 2
  const midEach = 0.2 / midCount
  return path.map((p, i) => {
    if (i === 0) return { affiliateId: p.affiliateId, weight: 0.4, clickId: p.clickId, role: 'first' as const }
    if (i === n - 1) return { affiliateId: p.affiliateId, weight: 0.4, clickId: p.clickId, role: 'last' as const }
    return { affiliateId: p.affiliateId, weight: midEach, clickId: p.clickId, role: 'middle' as const }
  })
}

function pickPrimary(
  shares: AttributionShare[],
  model: CookieModel,
  path: Array<{ affiliateId: string; clickId: string }>,
): AttributionShare {
  if (shares.length === 0) {
    return { affiliateId: path[0].affiliateId, weight: 1, clickId: path[0].clickId, role: 'only' }
  }
  if (model === 'first_click') {
    return shares.find((s) => s.role === 'first' || s.role === 'only') ?? shares[0]
  }
  if (model === 'last_click') {
    return shares.find((s) => s.role === 'last' || s.role === 'only') ?? shares[shares.length - 1]
  }
  // multi-touch: highest weight, tie → last in path
  let best = shares[0]
  for (const s of shares) {
    if (s.weight > best.weight) best = s
  }
  return best
}
