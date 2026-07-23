import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CommissionsService } from '../commissions/commissions.service'

export type FraudDecision = 'allow' | 'review' | 'block'

export interface FraudSignal {
  code: string
  weight: number
  detail?: string
}

export interface FraudCheckResult {
  /** Backward-compatible: true when decision === 'block' */
  blocked: boolean
  reason?: string
  decision: FraudDecision
  score: number
  reasons: string[]
  signals: FraudSignal[]
}

export interface FraudSettings {
  reviewThreshold: number
  blockThreshold: number
  orderVelocityLimit: number
  orderVelocityWindowHours: number
  ipVelocityLimit: number
  ipVelocityWindowMinutes: number
  allowlistAffiliateIds: string[]
}

const DEFAULTS: FraudSettings = {
  reviewThreshold: 40,
  blockThreshold: 80,
  orderVelocityLimit: 5,
  orderVelocityWindowHours: 24,
  ipVelocityLimit: 15,
  ipVelocityWindowMinutes: 60,
  allowlistAffiliateIds: [],
}

// Signal weights (sum can exceed 100; decision uses thresholds).
const W = {
  self_referral: 100,
  order_velocity: 50,
  ip_velocity: 40,
  new_affiliate_burst: 25,
  high_value: 15,
  duplicate_customer_orders: 20,
} as const

@Injectable()
export class FraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commissions: CommissionsService,
  ) {}

  async getSettings(organizationId: string): Promise<FraudSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const s = ((org?.settings ?? {}) as Record<string, unknown>).fraud as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') return { ...DEFAULTS }
    return {
      reviewThreshold: num(s.reviewThreshold, DEFAULTS.reviewThreshold),
      blockThreshold: num(s.blockThreshold, DEFAULTS.blockThreshold),
      orderVelocityLimit: num(s.orderVelocityLimit, DEFAULTS.orderVelocityLimit),
      orderVelocityWindowHours: num(s.orderVelocityWindowHours, DEFAULTS.orderVelocityWindowHours),
      ipVelocityLimit: num(s.ipVelocityLimit, DEFAULTS.ipVelocityLimit),
      ipVelocityWindowMinutes: num(s.ipVelocityWindowMinutes, DEFAULTS.ipVelocityWindowMinutes),
      allowlistAffiliateIds: Array.isArray(s.allowlistAffiliateIds)
        ? (s.allowlistAffiliateIds as unknown[]).map(String)
        : [],
    }
  }

  async updateSettings(organizationId: string, patch: Partial<FraudSettings>): Promise<FraudSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!org) throw new NotFoundException('Organization not found')
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prev = await this.getSettings(organizationId)
    const next: FraudSettings = {
      ...prev,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    } as FraudSettings
    if (next.reviewThreshold > next.blockThreshold) {
      throw new BadRequestException('reviewThreshold must be <= blockThreshold')
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, fraud: next } as any },
    })
    return next
  }

  /**
   * Score an attributed order. Higher score = riskier.
   * decision: allow | review | block (blocked stays true when block for legacy callers).
   */
  async checkOrder(args: {
    organizationId: string
    affiliateId: string
    customerId?: string | null
    storeId?: string | null
    ipHash?: string | null
    orderTotal?: number | null
  }): Promise<FraudCheckResult> {
    const { organizationId, affiliateId, customerId, ipHash, orderTotal } = args
    const settings = await this.getSettings(organizationId)

    if (settings.allowlistAffiliateIds.includes(affiliateId)) {
      return { blocked: false, decision: 'allow', score: 0, reasons: [], signals: [] }
    }

    const signals: FraudSignal[] = []

    // 1. Self-referral: affiliate user email === customer email
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { userId: true, createdAt: true, status: true },
    })
    if (affiliate?.userId && customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { email: true },
      })
      if (customer?.email) {
        const sameUser = await this.prisma.user.findFirst({
          where: { id: affiliate.userId, email: customer.email },
          select: { id: true },
        })
        if (sameUser) {
          signals.push({ code: 'self_referral', weight: W.self_referral, detail: customer.email })
        }
      }
    }

    // 2. Order velocity: same customer + affiliate in window
    if (customerId) {
      const since = new Date(Date.now() - settings.orderVelocityWindowHours * 3_600_000)
      const velocityCount = await this.prisma.order.count({
        where: { customerId, affiliateId, createdAt: { gte: since } },
      })
      if (velocityCount >= settings.orderVelocityLimit) {
        signals.push({
          code: 'order_velocity',
          weight: W.order_velocity,
          detail: `${velocityCount} orders / ${settings.orderVelocityWindowHours}h (limit ${settings.orderVelocityLimit})`,
        })
      }
    }

    // 3. IP / click velocity
    if (ipHash) {
      const since = new Date(Date.now() - settings.ipVelocityWindowMinutes * 60_000)
      const clickCount = await this.prisma.click.count({
        where: { affiliateId, ipHash, occurredAt: { gte: since } },
      })
      if (clickCount >= settings.ipVelocityLimit) {
        signals.push({
          code: 'ip_velocity',
          weight: W.ip_velocity,
          detail: `${clickCount} clicks / ${settings.ipVelocityWindowMinutes}m (limit ${settings.ipVelocityLimit})`,
        })
      }
    }

    // 4. New affiliate burst: affiliate < 48h old and already has 3+ attributed orders
    if (affiliate?.createdAt) {
      const ageMs = Date.now() - new Date(affiliate.createdAt).getTime()
      if (ageMs < 48 * 3_600_000) {
        const recentOrders = await this.prisma.order.count({
          where: {
            affiliateId,
            createdAt: { gte: new Date(Date.now() - 48 * 3_600_000) },
          },
        })
        if (recentOrders >= 3) {
          signals.push({
            code: 'new_affiliate_burst',
            weight: W.new_affiliate_burst,
            detail: `${recentOrders} orders in first 48h`,
          })
        }
      }
    }

    // 5. High-value order (absolute USD-ish threshold; org can still review)
    if (typeof orderTotal === 'number' && orderTotal >= 1000) {
      signals.push({
        code: 'high_value',
        weight: W.high_value,
        detail: `order total ${orderTotal}`,
      })
    }

    // 6. Same customer already has open fraud review (possible repeat abuse)
    if (customerId) {
      const openDup = await this.prisma.fraudReview.count({
        where: {
          organizationId,
          status: 'open',
          order: { customerId },
        },
      })
      if (openDup > 0) {
        signals.push({
          code: 'duplicate_customer_orders',
          weight: W.duplicate_customer_orders,
          detail: `${openDup} open review(s) for customer`,
        })
      }
    }

    const score = Math.min(
      100,
      signals.reduce((sum, sig) => sum + sig.weight, 0),
    )
    const reasons = signals.map((sig) => sig.code)

    let decision: FraudDecision = 'allow'
    if (score >= settings.blockThreshold) decision = 'block'
    else if (score >= settings.reviewThreshold) decision = 'review'

    return {
      blocked: decision === 'block',
      reason: reasons[0],
      decision,
      score,
      reasons,
      signals,
    }
  }

  /** Persist a review-queue row when decision is review (or optional block audit). */
  async createReview(args: {
    organizationId: string
    orderId: string
    affiliateId: string
    result: FraudCheckResult
  }) {
    return this.prisma.fraudReview.upsert({
      where: { orderId_affiliateId: { orderId: args.orderId, affiliateId: args.affiliateId } },
      create: {
        organizationId: args.organizationId,
        orderId: args.orderId,
        affiliateId: args.affiliateId,
        score: args.result.score,
        decision: args.result.decision,
        status: 'open',
        reasons: args.result.reasons,
        signals: args.result.signals as any,
      },
      // A provider retry must not reopen or rewrite an administrator's decision.
      update: {},
    })
  }

  async listReviews(organizationId: string, status?: string) {
    const validStatuses = new Set(['open', 'approved', 'rejected'])
    if (status && !validStatuses.has(status)) throw new BadRequestException('Invalid fraud review status')
    return this.prisma.fraudReview.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        order: { select: { id: true, externalOrderId: true, total: true, currency: true, status: true } },
        affiliate: { select: { id: true, affiliateCode: true, referralSlug: true, status: true } },
      },
    })
  }

  async approve(organizationId: string, reviewId: string, actorUserId: string, notes?: string) {
    const review = await this.prisma.fraudReview.findFirst({
      where: { id: reviewId, organizationId },
      include: { order: true },
    })
    if (!review) throw new NotFoundException('Fraud review not found')
    if (review.status !== 'open') throw new BadRequestException('Review is not open')

    const reviewedAt = new Date()
    const claimed = await this.prisma.fraudReview.updateMany({
      where: { id: reviewId, organizationId, status: 'open' },
      data: {
        status: 'approved',
        reviewedById: actorUserId,
        reviewedAt,
        notes: notes ?? review.notes,
      },
    })
    if (claimed.count !== 1) throw new BadRequestException('Review was already decided')

    const order = review.order
    let commission
    try {
      // Manual review approval — attribution was already decided at ingest time.
      commission = await this.commissions.generateForOrder(
        organizationId,
        {
          id: order.id,
          storeId: order.storeId,
          subtotal: order.subtotal,
          total: order.total,
          currency: order.currency,
        },
        review.affiliateId,
        { method: 'manual', clickId: null },
      )
    } catch (error) {
      await this.prisma.fraudReview.updateMany({
        where: { id: reviewId, status: 'approved', reviewedById: actorUserId, reviewedAt },
        data: { status: 'open', reviewedById: null, reviewedAt: null },
      }).catch(() => undefined)
      throw error
    }
    const updated = await this.prisma.fraudReview.findUniqueOrThrow({ where: { id: reviewId } })

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'fraud_review.approve',
      resourceType: 'fraud_review',
      resourceId: reviewId,
      newValue: { commissionId: (commission as any)?.id, score: review.score },
    })

    return { review: updated, commission }
  }

  async reject(organizationId: string, reviewId: string, actorUserId: string, notes?: string) {
    const review = await this.prisma.fraudReview.findFirst({
      where: { id: reviewId, organizationId },
    })
    if (!review) throw new NotFoundException('Fraud review not found')
    if (review.status !== 'open') throw new BadRequestException('Review is not open')

    const claimed = await this.prisma.fraudReview.updateMany({
      where: { id: reviewId, organizationId, status: 'open' },
      data: {
        status: 'rejected',
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        notes: notes ?? review.notes,
      },
    })
    if (claimed.count !== 1) throw new BadRequestException('Review was already decided')
    const updated = await this.prisma.fraudReview.findUniqueOrThrow({ where: { id: reviewId } })

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'fraud_review.reject',
      resourceType: 'fraud_review',
      resourceId: reviewId,
      newValue: { score: review.score, reasons: review.reasons },
    })

    return { review: updated }
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
