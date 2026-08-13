import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FREE_FALLBACK, FeatureKey, LimitKey } from './entitlements.constants'

export interface EntitlementContext {
  planKey: string | null
  planName: string | null
  status: string | null
  features: Record<string, boolean>
  limits: Record<string, number>
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
}

/**
 * Resolves what an organization is entitled to, based on its subscription's plan
 * plus any per-tenant overrides. Everything falls back to a denied-by-default
 * baseline so a missing/canceled subscription never silently grants access.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(organizationId: string): Promise<EntitlementContext> {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    })

    const base = { features: { ...FREE_FALLBACK.features }, limits: { ...FREE_FALLBACK.limits } }

    if (!sub || !sub.plan || sub.status === 'canceled') {
      return {
        planKey: sub?.plan?.key ?? null,
        planName: sub?.plan?.name ?? null,
        status: sub?.status ?? null,
        features: base.features,
        limits: base.limits,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        trialEndsAt: sub?.trialEndsAt ?? null,
      }
    }

    const planFeatures = (sub.plan.features ?? {}) as Record<string, boolean>
    const planLimits = (sub.plan.limits ?? {}) as Record<string, number>
    const overrides = (sub.overrides ?? {}) as {
      features?: Record<string, boolean>
      limits?: Record<string, number>
    }

    return {
      planKey: sub.plan.key,
      planName: sub.plan.name,
      status: sub.status,
      features: { ...base.features, ...planFeatures, ...(overrides.features ?? {}) },
      limits: { ...base.limits, ...planLimits, ...(overrides.limits ?? {}) },
      currentPeriodEnd: sub.currentPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
    }
  }

  async can(organizationId: string, feature: FeatureKey): Promise<boolean> {
    const ctx = await this.getContext(organizationId)
    return ctx.features[feature] === true
  }

  async assertFeature(organizationId: string, feature: FeatureKey): Promise<void> {
    if (!(await this.can(organizationId, feature))) {
      throw new ForbiddenException(
        `Your current plan does not include "${feature}". Upgrade your plan to unlock it.`,
      )
    }
  }

  async getLimit(organizationId: string, limit: LimitKey): Promise<number> {
    const ctx = await this.getContext(organizationId)
    const v = ctx.limits[limit]
    return typeof v === 'number' ? v : 0
  }

  /** Throws when creating `additional` more of `limit` would exceed the plan cap. */
  async assertWithinLimit(organizationId: string, limit: LimitKey, additional = 1): Promise<void> {
    const max = await this.getLimit(organizationId, limit)
    if (max < 0) return // unlimited
    const current = await this.countUsage(organizationId, limit)
    if (current + additional > max) {
      throw new ForbiddenException(
        `You have reached your plan limit for ${limit} (${max}). Upgrade your plan to add more.`,
      )
    }
  }

  async countUsage(organizationId: string, limit: LimitKey): Promise<number> {
    switch (limit) {
      case 'affiliates':
        return this.prisma.affiliate.count({ where: { organizationId } })
      case 'stores':
        return this.prisma.store.count({ where: { organizationId } })
      case 'teamMembers':
        return this.prisma.user.count({ where: { organizationId } })
      case 'apiKeys':
        return this.prisma.apiKey.count({ where: { organizationId } })
      default:
        return 0
    }
  }

  async usage(organizationId: string): Promise<Record<LimitKey, number>> {
    const [affiliates, stores, teamMembers, apiKeys] = await Promise.all([
      this.prisma.affiliate.count({ where: { organizationId } }),
      this.prisma.store.count({ where: { organizationId } }),
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.apiKey.count({ where: { organizationId } }),
    ])
    return { affiliates, stores, teamMembers, apiKeys }
  }
}
