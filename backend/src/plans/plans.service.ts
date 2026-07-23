import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FEATURE_KEYS, LIMIT_KEYS, FEATURE_LABELS, LIMIT_LABELS, type FeatureKey, type LimitKey } from '../entitlements/entitlements.constants'

/** Read helpers for plans. Mutations live in the super-admin module. */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public pricing list: visible, non-archived plans ordered for display. */
  listPublic() {
    return this.prisma.plan.findMany({
      where: { isPublic: true, isArchived: false },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    })
  }


  /**
   * Public, presentation-friendly plan list for the marketing site.
   * Maps stored plans (price + entitlement flags/limits) into the display
   * shape the marketing pricing page expects: { plans: [...] }.
   */
  async listPublicForMarketing() {
    const rows = await this.listPublic()
    const plans = rows.map((p, i) => {
      const dollars = Math.round(p.priceCents / 100)
      // We store one price per interval; derive a monthly figure and a
      // discounted annual-per-month figure (20%) to match the pricing toggle.
      const monthly = p.interval === 'year' ? Math.round(dollars / 12) : dollars
      const annual = monthly === 0 ? 0 : Math.round(monthly * 0.8)
      const limits = (p.limits ?? {}) as Record<string, number>
      const features = (p.features ?? {}) as Record<string, boolean>
      const bullets: string[] = []
      for (const k of LIMIT_KEYS) {
        const v = limits[k]
        if (v === undefined || v === null) continue
        bullets.push(v < 0 ? `Unlimited ${LIMIT_LABELS[k as LimitKey].toLowerCase()}` : `Up to ${v.toLocaleString('en-US')} ${LIMIT_LABELS[k as LimitKey].toLowerCase()}`)
      }
      for (const k of FEATURE_KEYS) {
        if (features[k]) bullets.push(FEATURE_LABELS[k as FeatureKey])
      }
      return {
        id: p.key,
        name: p.name,
        tagline: p.description ?? undefined,
        monthly,
        annual,
        currency: p.currency,
        featured: rows.length >= 3 ? i === 1 : false,
        cta: monthly === 0 ? 'Start free' : 'Start free trial',
        features: bullets,
      }
    })
    return { plans }
  }

  /** Every plan (super-admin). */
  listAll() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] })
  }

  async get(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } })
    if (!plan) throw new NotFoundException('Plan not found')
    return plan
  }
}
