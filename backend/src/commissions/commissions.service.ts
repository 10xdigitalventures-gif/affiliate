import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'
import * as T from '../mail/templates'

type OrderLike = {
  id: string
  storeId: string
  subtotal: Prisma.Decimal
  total: Prisma.Decimal
  currency: string
}

/**
 * Commission engine + ledger.
 * Rule matching priority (highest first): affiliate > product > category > store > campaign > global,
 * with an explicit `priority` field breaking ties. First match wins unless stackable.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  private scopeRank: Record<string, number> = {
    affiliate: 50,
    product: 40,
    category: 30,
    store: 20,
    campaign: 15,
    global: 10,
  }

  /** Find the single best commission rule for an order + affiliate. */
  async findRule(organizationId: string, order: OrderLike, affiliateId: string) {
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        organizationId,
        OR: [
          { scope: 'global' },
          { scope: 'store', scopeRefId: order.storeId },
          { scope: 'affiliate', scopeRefId: affiliateId },
        ],
      },
    })
    if (rules.length === 0) return null
    rules.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return (this.scopeRank[b.scope] ?? 0) - (this.scopeRank[a.scope] ?? 0)
    })
    return rules[0]
  }

  /** Compute a commission amount from a rule and an order. */
  computeAmount(rule: { type: string; value: Prisma.Decimal }, order: OrderLike): Prisma.Decimal {
    const base = new Prisma.Decimal(order.subtotal)
    const value = new Prisma.Decimal(rule.value)
    switch (rule.type) {
      case 'percentage':
      case 'tiered':
      case 'recurring':
        return base.mul(value).div(100)
      case 'fixed':
        return value
      default:
        return new Prisma.Decimal(0)
    }
  }

  /** Per-line commission amount. Fixed rules are treated as per-unit (value * quantity). */
  computeLineAmount(rule: { type: string; value: Prisma.Decimal }, lineBase: Prisma.Decimal, quantity: number): Prisma.Decimal {
    const value = new Prisma.Decimal(rule.value)
    switch (rule.type) {
      case 'percentage':
      case 'tiered':
      case 'recurring':
        return lineBase.mul(value).div(100)
      case 'fixed':
        return value.mul(quantity)
      default:
        return new Prisma.Decimal(0)
    }
  }

  /**
   * Pick the single best rule for a specific line-item context. Unlike findRule,
   * this enforces scopeRefId matching so per-product / per-category rules only
   * apply to their own product/category. Ties: priority, then scope rank.
   */
  private pickBestRule(
    rules: Array<{ id: string; scope: string; scopeRefId?: string | null; priority: number; type: string; value: Prisma.Decimal }>,
    ctx: { productId?: string; categoryId?: string; affiliateId?: string; storeId?: string },
  ) {
    const matches = rules.filter((r) => {
      switch (r.scope) {
        case 'global': return true
        case 'store': return !!ctx.storeId && r.scopeRefId === ctx.storeId
        case 'affiliate': return !!ctx.affiliateId && r.scopeRefId === ctx.affiliateId
        case 'product': return !!ctx.productId && r.scopeRefId === ctx.productId
        case 'category': return !!ctx.categoryId && r.scopeRefId === ctx.categoryId
        default: return false
      }
    })
    if (matches.length === 0) return null
    matches.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return (this.scopeRank[b.scope] ?? 0) - (this.scopeRank[a.scope] ?? 0)
    })
    return matches[0]
  }

  /**
   * Resolve the commission for an order. Uses per-line PRODUCT/CATEGORY rules
   * when any exist, otherwise a single order-level rule (global/store/affiliate).
   * Returns total amount, a representative ruleId, and a per-line breakdown.
   */
  async computeOrderCommission(
    organizationId: string,
    order: OrderLike,
    affiliateId: string,
  ): Promise<{ amount: Prisma.Decimal; ruleId: string | null; breakdown: Array<{ itemId: string; amount: Prisma.Decimal; ruleId: string }> } | null> {
    // Load line items (with product -> category) when the model is available.
    const items: any[] =
      (await (this.prisma as any).orderItem?.findMany?.({
        where: { orderId: order.id },
        include: { product: true },
      })) ?? []

    const productIds = items.map((i) => i.productId).filter((x): x is string => !!x)
    const categoryIds = items.map((i) => i.product?.categoryId).filter((x): x is string => !!x)

    const rules = await this.prisma.commissionRule.findMany({
      where: {
        organizationId,
        OR: [
          { scope: 'global' },
          { scope: 'store', scopeRefId: order.storeId },
          { scope: 'affiliate', scopeRefId: affiliateId },
          ...(productIds.length ? [{ scope: 'product' as any, scopeRefId: { in: productIds } }] : []),
          ...(categoryIds.length ? [{ scope: 'category' as any, scopeRefId: { in: categoryIds } }] : []),
        ],
      },
    })
    if (rules.length === 0) return null

    const hasLineRules = rules.some((r) => r.scope === 'product' || r.scope === 'category')

    // Order-level path (no product/category rules, or no line items).
    if (!hasLineRules || items.length === 0) {
      const candidates = rules.filter((r) => r.scope === 'global' || r.scope === 'store' || r.scope === 'affiliate')
      if (candidates.length === 0) return null
      candidates.sort((a, b) =>
        b.priority !== a.priority ? b.priority - a.priority : (this.scopeRank[b.scope] ?? 0) - (this.scopeRank[a.scope] ?? 0),
      )
      const rule = candidates[0]
      return { amount: this.computeAmount(rule, order), ruleId: rule.id, breakdown: [] }
    }

    // Per-line path: best rule per item, summed. Lines with no matching rule earn 0.
    let total = new Prisma.Decimal(0)
    const breakdown: Array<{ itemId: string; amount: Prisma.Decimal; ruleId: string }> = []
    for (const item of items) {
      const rule = this.pickBestRule(rules, {
        productId: item.productId ?? undefined,
        categoryId: item.product?.categoryId ?? undefined,
        affiliateId,
        storeId: order.storeId,
      })
      if (!rule) continue
      const lineBase = new Prisma.Decimal(item.unitPrice).mul(item.quantity ?? 1)
      const lineAmount = this.computeLineAmount(rule, lineBase, item.quantity ?? 1)
      total = total.add(lineAmount)
      breakdown.push({ itemId: item.id, amount: lineAmount, ruleId: rule.id })
    }
    if (breakdown.length === 0) return null
    return { amount: total, ruleId: breakdown[0].ruleId, breakdown }
  }

  /**
   * Sub-affiliate / multi-tier override config, stored in org.settings JSON.
   *   subAffiliateEnabled  master switch (default false)
   *   subAffiliateRate     % of the DIRECT commission paid up each tier (default 10)
   *   subAffiliateMaxDepth how many tiers up to reward (default 1)
   *   subAffiliateDecay    multiply the rate by this each tier up (default 1 = flat)
   */
  async getSubAffiliateConfig(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const s = (org?.settings ?? {}) as Record<string, unknown>
    return {
      enabled: s.subAffiliateEnabled === true,
      rate: typeof s.subAffiliateRate === 'number' ? s.subAffiliateRate : 10,
      maxDepth: typeof s.subAffiliateMaxDepth === 'number' ? s.subAffiliateMaxDepth : 1,
      decay: typeof s.subAffiliateDecay === 'number' ? s.subAffiliateDecay : 1,
    }
  }

  /**
   * Channel-based commission override (paid vs organic x link vs code).
   * Configured per-org in settings.commissionChannel. Returns a % rate to apply
   * to the order subtotal, or null when no override applies for this combo.
   */
  async getCommissionChannelConfig(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const s = ((org?.settings ?? {}) as any).commissionChannel ?? {}
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : undefined)
    return {
      enabled: s.enabled === true,
      codeOrganicRate: num(s.codeOrganicRate),
      codePaidRate: num(s.codePaidRate),
      linkOrganicRate: num(s.linkOrganicRate),
      linkPaidRate: num(s.linkPaidRate),
    }
  }

  private resolveChannelRate(
    cfg: { enabled: boolean; codeOrganicRate?: number; codePaidRate?: number; linkOrganicRate?: number; linkPaidRate?: number },
    attributionType: string,
    channel: string,
  ): number | null {
    if (!cfg.enabled) return null
    const paid = channel === 'paid'
    let r: number | undefined
    if (attributionType === 'code') r = paid ? cfg.codePaidRate : cfg.codeOrganicRate
    else if (attributionType === 'link') r = paid ? cfg.linkPaidRate : cfg.linkOrganicRate
    return typeof r === 'number' ? r : null
  }

  /** Resolve a channel override rate for an org (loads config, then matches combo). */
  async resolveChannelRateForOrg(organizationId: string, attributionType: string, channel: string): Promise<number | null> {
    const cfg = await this.getCommissionChannelConfig(organizationId)
    return this.resolveChannelRate(cfg, attributionType, channel)
  }

  /**
   * New-vs-returning customer commission override, stored in org.settings.customerType.
   *   enabled                master switch (default false)
   *   newCustomerRate        % applied to subtotal for a customer's FIRST purchase
   *   returningCustomerRate  % applied to subtotal for repeat customers
   */
  async getCustomerTypeConfig(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const s = ((org?.settings ?? {}) as any).customerType ?? {}
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : undefined)
    return {
      enabled: s.enabled === true,
      newRate: num(s.newCustomerRate),
      returningRate: num(s.returningCustomerRate),
    }
  }

  /** Resolve the new/returning override rate for an org, or null when it doesn't apply. */
  async resolveCustomerRateForOrg(
    organizationId: string,
    customerType: 'new' | 'returning' | null | undefined,
  ): Promise<number | null> {
    if (!customerType) return null
    const cfg = await this.getCustomerTypeConfig(organizationId)
    if (!cfg.enabled) return null
    const r = customerType === 'new' ? cfg.newRate : cfg.returningRate
    return typeof r === 'number' ? r : null
  }

  /** Generate a pending commission + conversion for an attributed order. */
  async generateForOrder(
    organizationId: string,
    order: OrderLike,
    affiliateId: string,
    attribution: { method: string; clickId?: string | null; channel?: string | null; attributionType?: string | null; customerType?: 'new' | 'returning' | null },
  ) {
    const existing = await this.prisma.commission.findFirst({ where: { orderId: order.id } })
    if (existing) return existing // idempotent

    const attributionType = attribution.attributionType ?? (attribution.method === 'coupon' ? 'code' : attribution.method === 'cookie' ? 'link' : attribution.method)
    const channel = attribution.channel === 'paid' ? 'paid' : 'organic'

    let amount: Prisma.Decimal
    let ruleId: string | null
    let breakdown: Array<{ itemId: string; amount: Prisma.Decimal; ruleId: string }>
    // Rate precedence: new-vs-returning customer override > paid/organic channel override > rule engine.
    const customerRate = await this.resolveCustomerRateForOrg(organizationId, attribution.customerType ?? null)
    const channelRate = customerRate == null ? await this.resolveChannelRateForOrg(organizationId, attributionType, channel) : null
    const overrideRate = customerRate ?? channelRate
    if (overrideRate != null) {
      amount = new Prisma.Decimal(order.subtotal).mul(overrideRate).div(100).toDecimalPlaces(4)
      ruleId = null
      breakdown = []
    } else {
      const computed = await this.computeOrderCommission(organizationId, order, affiliateId)
      if (!computed) return null
      amount = computed.amount
      ruleId = computed.ruleId
      breakdown = computed.breakdown
    }

    const [commission] = await this.prisma.$transaction([
      this.prisma.commission.create({
        data: {
          orderId: order.id,
          affiliateId,
          commissionRuleId: ruleId,
          amount,
          currency: order.currency,
          status: 'pending',
          tier: 0,
          channel,
          attributionType,
          idempotencyKey: `order:${order.id}:affiliate:${affiliateId}:tier:0`,
        },
      }),
      this.prisma.conversion.create({
        data: {
          orderId: order.id,
          affiliateId,
          clickId: attribution.clickId ?? null,
          attributionMethod: attribution.method as any,
        },
      }),
    ])

    // Persist the per-line commission breakdown (product/category level).
    for (const line of breakdown) {
      await (this.prisma as any).orderItem
        ?.update?.({ where: { id: line.itemId }, data: { commissionAmount: line.amount } })
        .catch(() => {})
    }

    // Multi-tier: reward the recruiter chain above the selling affiliate.
    await this.generateOverrides(organizationId, order, affiliateId, commission.id, amount).catch((e) =>
      this.audit.log({ organizationId, action: 'commission.override_failed', resourceType: 'commission', resourceId: commission.id, newValue: { error: String(e?.message ?? e) } }).catch(() => {}),
    )

    return commission
  }

  /**
   * Multi-touch / split credit: create one commission per share (amount × weight).
   * Idempotent: if any commission already exists for the order, returns existing list.
   * Overrides (sub-affiliate) run only for the primary (highest-weight) share.
   */
  async generateSplitForOrder(
    organizationId: string,
    order: OrderLike,
    shares: Array<{ affiliateId: string; weight: number; clickId?: string | null }>,
    attribution: { method: string; model?: string; channel?: string | null; attributionType?: string | null; customerType?: 'new' | 'returning' | null },
  ) {
    const existing = await this.prisma.commission.findMany({ where: { orderId: order.id, tier: 0 } })
    if (existing.length > 0) return existing

    const normalized = shares.filter((s) => s.weight > 0 && s.affiliateId)
    if (normalized.length === 0) return []
    if (normalized.length === 1) {
      const one = await this.generateForOrder(
        organizationId,
        order,
        normalized[0].affiliateId,
        { method: attribution.method, clickId: normalized[0].clickId ?? null, channel: attribution.channel ?? null, attributionType: attribution.attributionType ?? null, customerType: attribution.customerType ?? null },
      )
      return one ? [one] : []
    }

    // Compute full order commission once using the primary (highest weight) affiliate's rules,
    // then split the dollar amount — product rules stay consistent with a single order valuation.
    const primary = normalized.reduce((a, b) => (b.weight > a.weight ? b : a))
    const attributionType = attribution.attributionType ?? (attribution.method === 'coupon' ? 'code' : attribution.method === 'cookie' ? 'link' : attribution.method)
    const channel = attribution.channel === 'paid' ? 'paid' : 'organic'
    const customerRate = await this.resolveCustomerRateForOrg(organizationId, attribution.customerType ?? null)
    const channelRate = customerRate == null ? await this.resolveChannelRateForOrg(organizationId, attributionType, channel) : null
    const overrideRate = customerRate ?? channelRate
    let fullAmount: Prisma.Decimal
    let ruleId: string | null
    let breakdown: Array<{ itemId: string; amount: Prisma.Decimal; ruleId: string }>
    if (overrideRate != null) {
      fullAmount = new Prisma.Decimal(order.subtotal).mul(overrideRate).div(100).toDecimalPlaces(4)
      ruleId = null
      breakdown = []
    } else {
      const computed = await this.computeOrderCommission(organizationId, order, primary.affiliateId)
      if (!computed) return []
      fullAmount = computed.amount
      ruleId = computed.ruleId
      breakdown = computed.breakdown
    }
    const full = new Prisma.Decimal(fullAmount)

    const created: any[] = []
    for (const share of normalized) {
      const shareAmount = full.mul(share.weight).toDecimalPlaces(4)
      if (shareAmount.lte(0)) continue
      const commission = await this.prisma.commission.create({
        data: {
          orderId: order.id,
          affiliateId: share.affiliateId,
          commissionRuleId: ruleId,
          amount: shareAmount,
          currency: order.currency,
          status: 'pending',
          tier: 0,
          channel,
          attributionType,
          idempotencyKey: `order:${order.id}:affiliate:${share.affiliateId}:tier:0:split`,
        },
      })
      await this.prisma.conversion.create({
        data: {
          orderId: order.id,
          affiliateId: share.affiliateId,
          clickId: share.clickId ?? null,
          attributionMethod: attribution.method as any,
        },
      }).catch(() => {})
      created.push(commission)
    }

    // Line breakdown on primary only (full order view).
    for (const line of breakdown) {
      await (this.prisma as any).orderItem
        ?.update?.({ where: { id: line.itemId }, data: { commissionAmount: line.amount } })
        .catch(() => {})
    }

    const primaryCommission = created.find((c) => c.affiliateId === primary.affiliateId) ?? created[0]
    if (primaryCommission) {
      await this.generateOverrides(
        organizationId,
        order,
        primary.affiliateId,
        primaryCommission.id,
        primaryCommission.amount,
      ).catch((e) =>
        this.audit
          .log({
            organizationId,
            action: 'commission.override_failed',
            resourceType: 'commission',
            resourceId: primaryCommission.id,
            newValue: { error: String(e?.message ?? e), model: attribution.model },
          })
          .catch(() => {}),
      )
    }

    return created
  }

  /**
   * Walk up the parentAffiliate chain and create override commissions.
   * Each override = directAmount * (rate% * decay^(tier-1)), linked to the source
   * commission via sourceCommissionId. Cycle-guarded and capped at maxDepth.
   */
  async generateOverrides(
    organizationId: string,
    order: OrderLike,
    sellerAffiliateId: string,
    sourceCommissionId: string,
    directAmount: Prisma.Decimal,
  ) {
    const cfg = await this.getSubAffiliateConfig(organizationId)
    if (!cfg.enabled || cfg.rate <= 0 || cfg.maxDepth <= 0) return

    const seen = new Set<string>([sellerAffiliateId])
    let currentId: string | null = sellerAffiliateId
    const base = new Prisma.Decimal(directAmount)

    for (let tier = 1; tier <= cfg.maxDepth; tier++) {
      const current: { parentAffiliateId: string | null } | null = await this.prisma.affiliate.findUnique({
        where: { id: currentId! },
        select: { parentAffiliateId: true },
      })
      const parentId = current?.parentAffiliateId
      if (!parentId || seen.has(parentId)) break // top of chain or cycle
      seen.add(parentId)

      // Only reward active parents.
      const parent = await this.prisma.affiliate.findFirst({
        where: { id: parentId, organizationId, status: 'approved' },
        select: { id: true },
      })
      if (parent) {
        const effectiveRate = new Prisma.Decimal(cfg.rate).mul(new Prisma.Decimal(cfg.decay).pow(tier - 1))
        const overrideAmount = base.mul(effectiveRate).div(100)
        if (overrideAmount.gt(0)) {
          await this.prisma.commission.create({
            data: {
              orderId: order.id,
              affiliateId: parentId,
              amount: overrideAmount,
              currency: order.currency,
              status: 'pending',
              tier,
              sourceCommissionId,
              idempotencyKey: `order:${order.id}:affiliate:${parentId}:tier:${tier}:override:${sourceCommissionId}`,
            },
          })
        }
      }
      currentId = parentId
    }
  }

  async approve(organizationId: string, id: string) {
    const commission = await this.getScoped(organizationId, id)
    if (!['pending', 'approved'].includes(commission.status)) {
      throw new BadRequestException(`Cannot approve a ${commission.status} commission`)
    }
    const updated = await this.prisma.commission.update({ where: { id }, data: { status: 'approved' } })
    await this.audit.log({ organizationId, action: 'commission.approve', resourceType: 'commission', resourceId: id, oldValue: { status: commission.status }, newValue: { status: 'approved' } }).catch(() => {})
    // Notify affiliate: commission approved (in-app + email)
    this.prisma.affiliate.findUnique({ where: { id: commission.affiliateId }, include: { user: true } }).then((aff) => {
      if (!aff) return
      const amount = Number(updated.amount).toFixed(2)
      const currency = updated.currency ?? 'USD'
      this.notifications.notifyUser(organizationId, aff.userId, {
        type: 'commission.approved',
        title: `Commission approved — ${amount} ${currency}`,
        body: 'A commission has been approved and added to your balance.',
        data: { commissionId: id, amount, currency },
      }).catch(() => {})
      if (!aff.user?.email) return
      this.prisma.organization.findUnique({ where: { id: organizationId } }).then((org) => {
        this.mail.send({
          to: aff.user!.email!,
          ...T.commissionApproved({
            orgName: org?.name ?? 'Us',
            firstName: aff.user!.fullName?.split(' ')[0] ?? 'there',
            amount,
            currency,
            portalUrl: (process.env.APP_URL ?? 'http://localhost:3000') + '/portal',
            settings: org?.settings ?? null,
          }),
        })
      })
    }).catch(() => {})
    return updated
  }

  async markPayable(organizationId: string, id: string) {
    const commission = await this.getScoped(organizationId, id)
    if (commission.status !== 'approved') {
      throw new BadRequestException('Only approved commissions become payable')
    }
    return this.prisma.commission.update({ where: { id }, data: { status: 'payable' } })
  }

  /** Full reversal (e.g. cancelled order). Records an adjustment and flips status. */
  async reverse(organizationId: string, id: string, reason: string, createdBy?: string) {
    const commission = await this.getScoped(organizationId, id)
    if (commission.status === 'paid') {
      // Already paid: record a clawback adjustment, deduct from future payouts.
      await this.prisma.commissionAdjustment.create({
        data: { commissionId: id, type: 'reversal', delta: new Prisma.Decimal(commission.amount).neg(), reason, createdBy },
      })
      await this.reverseOverrides(id, `Upline reversal: ${reason}`, createdBy)
      return this.prisma.commission.findUnique({ where: { id } })
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.commissionAdjustment.create({
        data: { commissionId: id, type: 'reversal', delta: new Prisma.Decimal(commission.amount).neg(), reason, createdBy },
      }),
      this.prisma.commission.update({ where: { id }, data: { status: 'reversed' } }),
    ])
    // Cascade: sub-affiliate overrides derived from this commission must reverse too.
    await this.reverseOverrides(id, `Upline reversal: ${reason}`, createdBy)
    return updated
  }

  /** Reverse all tier>0 override commissions derived from a source commission. */
  private async reverseOverrides(sourceCommissionId: string, reason: string, createdBy?: string) {
    const overrides = await this.prisma.commission.findMany({
      where: { sourceCommissionId, status: { notIn: ['reversed', 'cancelled'] } },
    })
    for (const o of overrides) {
      const isPaid = o.status === 'paid'
      await this.prisma.$transaction([
        this.prisma.commissionAdjustment.create({
          data: { commissionId: o.id, type: 'reversal', delta: new Prisma.Decimal(o.amount).neg(), reason, createdBy },
        }),
        ...(isPaid ? [] : [this.prisma.commission.update({ where: { id: o.id }, data: { status: 'reversed' } })]),
      ])
    }
  }

  /** Proportional adjustment when an order is partially/fully refunded. */
  async handleRefund(order: { id: string; total: Prisma.Decimal; refundAmount: Prisma.Decimal }) {
    const commissions = await this.prisma.commission.findMany({
      where: { orderId: order.id, status: { notIn: ['reversed', 'cancelled'] } },
    })
    const total = new Prisma.Decimal(order.total)
    const refund = new Prisma.Decimal(order.refundAmount)
    if (total.lte(0)) return
    const ratio = Prisma.Decimal.min(refund.div(total), new Prisma.Decimal(1))

    for (const c of commissions) {
      // Skip overrides here; they are adjusted proportionally alongside their source below.
      if (c.tier && c.tier > 0) continue
      const delta = new Prisma.Decimal(c.amount).mul(ratio).neg()
      const isFull = ratio.gte(1)
      await this.prisma.$transaction([
        this.prisma.commissionAdjustment.create({
          data: {
            commissionId: c.id,
            type: isFull ? 'reversal' : 'partial_refund',
            delta,
            reason: `Refund of ${refund.toString()} on order ${order.id}`,
          },
        }),
        this.prisma.commission.update({
          where: { id: c.id },
          data: isFull ? { status: 'reversed' } : {},
        }),
      ])

      // Proportionally adjust the sub-affiliate overrides tied to this commission.
      const overrides = await this.prisma.commission.findMany({
        where: { sourceCommissionId: c.id, status: { notIn: ['reversed', 'cancelled'] } },
      })
      for (const o of overrides) {
        const oDelta = new Prisma.Decimal(o.amount).mul(ratio).neg()
        await this.prisma.$transaction([
          this.prisma.commissionAdjustment.create({
            data: {
              commissionId: o.id,
              type: isFull ? 'reversal' : 'partial_refund',
              delta: oDelta,
              reason: `Upline refund of ${refund.toString()} on order ${order.id}`,
            },
          }),
          this.prisma.commission.update({
            where: { id: o.id },
            data: isFull ? { status: 'reversed' } : {},
          }),
        ])
      }
    }
  }

  async list(organizationId: string, params: { affiliateId?: string; status?: string; skip?: number; take?: number }) {
    const where: Prisma.CommissionWhereInput = {
      affiliate: { organizationId },
      ...(params.affiliateId ? { affiliateId: params.affiliateId } : {}),
      ...(params.status ? { status: params.status as any } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commission.findMany({ where, skip: params.skip ?? 0, take: params.take ?? 25, orderBy: { createdAt: 'desc' }, include: { adjustments: true } }),
      this.prisma.commission.count({ where }),
    ])
    return { items, total }
  }

  private async getScoped(organizationId: string, id: string) {
    const commission = await this.prisma.commission.findFirst({
      where: { id, affiliate: { organizationId } },
    })
    if (!commission) throw new NotFoundException('Commission not found')
    return commission
  }
}
