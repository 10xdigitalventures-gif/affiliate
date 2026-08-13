import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AttributionService } from '../attribution/attribution.service'
import { CommissionsService } from '../commissions/commissions.service'
import { FraudService } from '../fraud/fraud.service'
import { IngestOrderDto } from './dto/ingest-order.dto'

/**
 * Normalised order ingestion. In Phase 2 the Shopify/WooCommerce webhook
 * handlers will map their payloads to IngestOrderDto and call ingest().
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
    private readonly commissions: CommissionsService,
    private readonly fraud: FraudService,
  ) {}

  async ingest(organizationId: string, dto: IngestOrderDto) {
    const store = await this.prisma.store.findFirst({ where: { id: dto.storeId, organizationId } })
    if (!store) throw new NotFoundException('Store not found')

    // Upsert customer (by email) if provided
    let customerId: string | null = null
    if (dto.customerEmail) {
      const customer = await this.prisma.customer.upsert({
        where: { id: dto.customerId ?? '00000000-0000-0000-0000-000000000000' },
        update: {},
        create: { organizationId, email: dto.customerEmail },
      }).catch(async () =>
        this.prisma.customer.create({ data: { organizationId, email: dto.customerEmail } }),
      )
      customerId = customer.id
    }

    // Resolve attribution BEFORE creating commission
    const attribution = await this.attribution.resolve(organizationId, {
      storeId: dto.storeId,
      couponCode: dto.couponCode,
      referralCode: dto.referralCode,
      clickId: dto.clickId ?? null,
      customerId,
      referrer: dto.referrer ?? dto.landingSite ?? null,
    })

    // ---- Traffic-source resolution (paid/organic + platform + UTM) ----
    // Prefer values captured at checkout (dto, from landing_site / cart attrs),
    // then BACKFILL from the attributed click so the ad platform + UTM survive
    // even when the storefront strips query params before checkout.
    let trafficChannel = dto.channel ?? null
    let adNetwork = dto.adNetwork ?? null
    const adClickId = dto.adClickId ?? null
    let utmSource = dto.utmSource ?? null
    let utmMedium = dto.utmMedium ?? null
    let utmCampaign = dto.utmCampaign ?? null
    let utmContent = dto.utmContent ?? null
    let utmTerm = dto.utmTerm ?? null
    const sourceClickId = attribution?.clickId ?? dto.clickId ?? null
    if (sourceClickId && (!trafficChannel || !utmSource || !adNetwork)) {
      const click = await this.prisma.click.findUnique({ where: { id: sourceClickId } })
      if (click) {
        const u = (click.utm ?? {}) as Record<string, string | undefined>
        trafficChannel = trafficChannel ?? (click.channel as 'paid' | 'organic' | null) ?? null
        adNetwork = adNetwork ?? click.adNetwork ?? null
        utmSource = utmSource ?? u.source ?? null
        utmMedium = utmMedium ?? u.medium ?? null
        utmCampaign = utmCampaign ?? u.campaign ?? null
        utmContent = utmContent ?? u.content ?? null
        utmTerm = utmTerm ?? u.term ?? null
      }
    }
    const attributionType =
      dto.attributionType ??
      (attribution?.method === 'coupon' ? 'code' : attribution ? 'link' : null)

    const subtotal = new Prisma.Decimal(dto.subtotal)
    const total = new Prisma.Decimal(dto.total ?? dto.subtotal)

    // Upsert order (idempotent on storeId + externalOrderId)
    const order = await this.prisma.order.upsert({
      where: { storeId_externalOrderId: { storeId: dto.storeId, externalOrderId: dto.externalOrderId } },
      update: {
        subtotal,
        total,
        status: dto.status ?? 'paid',
        affiliateId: attribution?.affiliateId ?? null,
        couponId: attribution?.couponId ?? null,
        // Only overwrite source fields when we resolved a value (undefined = keep).
        trafficChannel: trafficChannel ?? undefined,
        adNetwork: adNetwork ?? undefined,
        adClickId: adClickId ?? undefined,
        utmSource: utmSource ?? undefined,
        utmMedium: utmMedium ?? undefined,
        utmCampaign: utmCampaign ?? undefined,
        utmContent: utmContent ?? undefined,
        utmTerm: utmTerm ?? undefined,
        attributionType: attributionType ?? undefined,
        landingPage: dto.landingSite ?? undefined,
        referrer: dto.referrer ?? undefined,
      },
      create: {
        storeId: dto.storeId,
        externalOrderId: dto.externalOrderId,
        customerId,
        affiliateId: attribution?.affiliateId ?? null,
        couponId: attribution?.couponId ?? null,
        currency: dto.currency ?? 'USD',
        subtotal,
        total,
        status: dto.status ?? 'paid',
        trafficChannel,
        adNetwork,
        adClickId,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        attributionType,
        landingPage: dto.landingSite ?? null,
        referrer: dto.referrer ?? null,
        placedAt: dto.placedAt ? new Date(dto.placedAt) : new Date(),
      },
    })

    // Set lifetime affiliate on first attributed order for this customer
    if (attribution && customerId) {
      await this.prisma.customer.updateMany({
        where: { id: customerId, firstAffiliateId: null },
        data: { firstAffiliateId: attribution.affiliateId },
      })
    }

    // New-vs-returning: a customer is "returning" when they already have a prior order.
    let customerType: 'new' | 'returning' | null = null
    if (customerId) {
      const priorOrders = await this.prisma.order.count({
        where: { customerId, id: { not: order.id } },
      })
      customerType = priorOrders > 0 ? 'returning' : 'new'
    }

    let commission: any = null
    let fraud: { decision: string; score: number; reasons: string[]; reviewId?: string } | null = null
    if (attribution) {
      const fraudCheck = await this.fraud.checkOrder({
        organizationId,
        affiliateId: attribution.affiliateId,
        customerId,
        storeId: dto.storeId,
        orderTotal: Number(total),
      })
      // Anti-leak coupon protection: a suspected leaked coupon is forced into
      // manual review so the commission is never auto-approved.
      const leak = attribution.couponLeak
      const decision = leak?.suspected ? 'review' : fraudCheck.decision
      fraud = {
        decision,
        score: fraudCheck.score,
        reasons: leak?.suspected
          ? [...fraudCheck.reasons, `coupon-leak suspected: ${leak.reason}`]
          : fraudCheck.reasons,
      }

      if (decision === 'allow') {
        const orderLike = { id: order.id, storeId: order.storeId, subtotal, total, currency: order.currency }
        const multi =
          attribution.shares &&
          attribution.shares.length > 1 &&
          (attribution.model === 'linear' || attribution.model === 'position')
        if (multi) {
          const list = await this.commissions.generateSplitForOrder(
            organizationId,
            orderLike,
            attribution.shares,
            { method: attribution.method, model: attribution.model, customerType },
          )
          commission = list[0] ?? null
        } else {
          commission = await this.commissions.generateForOrder(
            organizationId,
            orderLike,
            attribution.affiliateId,
            { method: attribution.method, clickId: attribution.clickId, customerType },
          )
        }
      } else if (decision === 'review' || decision === 'block') {
        // Queue for manual review (block is also recorded so admins can audit hard denials).
        const review = await this.fraud.createReview({
          organizationId,
          orderId: order.id,
          affiliateId: attribution.affiliateId,
          result: fraudCheck,
        })
        fraud.reviewId = review.id
      }
    }

    return { order, attribution, commission, fraud }
  }

  async refund(organizationId: string, orderId: string, refundAmount: number) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, store: { organizationId } } })
    if (!order) throw new NotFoundException('Order not found')
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { refundAmount: new Prisma.Decimal(refundAmount) },
    })
    await this.commissions.handleRefund({ id: updated.id, total: updated.total, refundAmount: updated.refundAmount })
    return updated
  }

  /** Refund lookup by platform order id (used by webhook handlers). */
  async refundByExternal(organizationId: string, storeId: string, externalOrderId: string, amount: number) {
    const order = await this.prisma.order.findFirst({
      where: { storeId, externalOrderId, store: { organizationId } },
    })
    if (!order) return null
    return this.refund(organizationId, order.id, amount)
  }

  async list(organizationId: string, params: { skip?: number; take?: number }) {
    const where: Prisma.OrderWhereInput = { store: { organizationId } }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, skip: params.skip ?? 0, take: params.take ?? 25, orderBy: { createdAt: 'desc' } }),
      this.prisma.order.count({ where }),
    ])
    return { items, total }
  }
}
