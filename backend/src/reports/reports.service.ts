import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildCsv } from '../bulk/csv.util'

const EXCLUDED = ['reversed', 'cancelled'] as const
const MAX_REPORT_DAYS = 366

export type DateRange = { from: Date; to: Date; days: number }

function parseRange(args: { days?: number; from?: string; to?: string }): DateRange {
  if (args.days !== undefined && (!Number.isFinite(args.days) || args.days < 1)) {
    throw new BadRequestException('Report days must be a positive number')
  }
  const isDateOnly = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const to = isDateOnly(args.to) ? new Date(`${args.to}T23:59:59.999Z`) : args.to ? new Date(args.to) : new Date()
  if (Number.isNaN(to.getTime())) throw new BadRequestException('Invalid report end date')

  let from: Date
  let days: number
  if (args.from) {
    from = isDateOnly(args.from) ? new Date(`${args.from}T00:00:00.000Z`) : new Date(args.from)
    if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid report start date')
    if (from > to) throw new BadRequestException('Report start date must not be after the end date')
    const startDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
    const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
    days = Math.max(1, Math.floor((endDay - startDay) / 86_400_000) + 1)
  } else {
    days = args.days && args.days > 0 ? Math.floor(args.days) : 30
    from = new Date(to)
    from.setUTCHours(0, 0, 0, 0)
    // A seven-day range includes today plus the preceding six calendar days.
    from.setUTCDate(from.getUTCDate() - (days - 1))
  }

  if (days > MAX_REPORT_DAYS) {
    throw new BadRequestException(`Report range cannot exceed ${MAX_REPORT_DAYS} days`)
  }

  return { from, to, days }
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  resolveRange(query: { days?: number; from?: string; to?: string }): DateRange {
    return parseRange(query)
  }

  async summary(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const range = parseRange(rangeInput)
    const { from, to } = range

    const [revenue, commissions, activeAffiliates, orders, clicks, attributedOrders] =
      await Promise.all([
        this.prisma.order.aggregate({
          _sum: { total: true },
          _avg: { total: true },
          where: { store: { organizationId }, placedAt: { gte: from, lte: to } },
        }),
        this.prisma.commission.aggregate({
          _sum: { amount: true },
          where: {
            affiliate: { organizationId },
            createdAt: { gte: from, lte: to },
            status: { notIn: EXCLUDED as any },
          },
        }),
        this.prisma.affiliate.count({ where: { organizationId, status: 'approved' } }),
        this.prisma.order.count({
          where: { store: { organizationId }, placedAt: { gte: from, lte: to } },
        }),
        this.prisma.click.count({
          where: { affiliate: { organizationId }, occurredAt: { gte: from, lte: to } },
        }),
        this.prisma.order.count({
          where: {
            store: { organizationId },
            placedAt: { gte: from, lte: to },
            affiliateId: { not: null },
          },
        }),
      ])

    const rev = Number(revenue._sum.total ?? 0)
    const comm = Number(commissions._sum.amount ?? 0)
    const aov = Number(revenue._avg.total ?? 0)
    const conversionRate = clicks > 0 ? attributedOrders / clicks : 0
    const epc = clicks > 0 ? comm / clicks : 0
    const commissionRate = rev > 0 ? comm / rev : 0

    return {
      revenue: rev,
      commissions: comm,
      activeAffiliates,
      orders,
      clicks,
      attributedOrders,
      aov,
      conversionRate,
      epc,
      commissionRate,
      range: { from: from.toISOString(), to: to.toISOString(), days: range.days },
    }
  }

  async timeseries(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const range = parseRange(rangeInput)
    const { from, to, days } = range

    const [orders, commissions, clicks] = await Promise.all([
      this.prisma.order.findMany({
        where: { store: { organizationId }, placedAt: { gte: from, lte: to } },
        select: { total: true, placedAt: true, affiliateId: true },
      }),
      this.prisma.commission.findMany({
        where: {
          affiliate: { organizationId },
          createdAt: { gte: from, lte: to },
          status: { notIn: EXCLUDED as any },
        },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.click.findMany({
        where: { affiliate: { organizationId }, occurredAt: { gte: from, lte: to } },
        select: { occurredAt: true },
      }),
    ])

    const map = new Map<
      string,
      { date: string; revenue: number; commissions: number; orders: number; clicks: number }
    >()
    // Build day buckets covering the range
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(to)
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10)
      map.set(key, { date: key, revenue: 0, commissions: 0, orders: 0, clicks: 0 })
    }

    for (const o of orders) {
      const key = (o.placedAt ?? new Date()).toISOString().slice(0, 10)
      const e = map.get(key)
      if (e) {
        e.revenue += Number(o.total)
        e.orders += 1
      }
    }
    for (const c of commissions) {
      const key = c.createdAt.toISOString().slice(0, 10)
      const e = map.get(key)
      if (e) e.commissions += Number(c.amount)
    }
    for (const c of clicks) {
      const key = c.occurredAt.toISOString().slice(0, 10)
      const e = map.get(key)
      if (e) e.clicks += 1
    }

    return [...map.values()]
  }

  async topAffiliates(
    organizationId: string,
    limit = 5,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const range = parseRange(rangeInput)
    const { from, to } = range
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 5

    const grouped = await this.prisma.commission.groupBy({
      by: ['affiliateId'],
      where: {
        affiliate: { organizationId },
        status: { notIn: EXCLUDED as any },
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: safeLimit,
    })

    const ids = grouped.map((g) => g.affiliateId)
    const [affs, orderCounts, clickCounts] = await Promise.all([
      this.prisma.affiliate.findMany({ where: { id: { in: ids } } }),
      this.prisma.order.groupBy({
        by: ['affiliateId'],
        where: {
          affiliateId: { in: ids },
          placedAt: { gte: from, lte: to },
          store: { organizationId },
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.click.groupBy({
        by: ['affiliateId'],
        where: { affiliateId: { in: ids }, occurredAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ])

    const byId = new Map(affs.map((a) => [a.id, a]))
    const ordersBy = new Map(orderCounts.map((o) => [o.affiliateId!, o]))
    const clicksBy = new Map(clickCounts.map((c) => [c.affiliateId, c]))

    return grouped.map((g) => {
      const clicks = clicksBy.get(g.affiliateId)?._count._all ?? 0
      const ord = ordersBy.get(g.affiliateId)
      const orderCount = ord?._count._all ?? 0
      const revenue = Number(ord?._sum.total ?? 0)
      const total = Number(g._sum.amount ?? 0)
      return {
        affiliateId: g.affiliateId,
        affiliateCode: byId.get(g.affiliateId)?.affiliateCode ?? '—',
        total,
        commissionCount: g._count._all,
        orders: orderCount,
        revenue,
        clicks,
        epc: clicks > 0 ? total / clicks : 0,
        conversionRate: clicks > 0 ? orderCount / clicks : 0,
      }
    })
  }

  /** Revenue + orders grouped by store. */
  async byStore(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const { from, to } = parseRange(rangeInput)
    const stores = await this.prisma.store.findMany({
      where: { organizationId },
      select: { id: true, name: true, platform: true, domain: true },
    })
    const results = await Promise.all(
      stores.map(async (store) => {
        const [agg, count, comm] = await Promise.all([
          this.prisma.order.aggregate({
            _sum: { total: true },
            where: { storeId: store.id, placedAt: { gte: from, lte: to } },
          }),
          this.prisma.order.count({
            where: { storeId: store.id, placedAt: { gte: from, lte: to } },
          }),
          this.prisma.commission.aggregate({
            _sum: { amount: true },
            where: {
              order: { storeId: store.id },
              createdAt: { gte: from, lte: to },
              status: { notIn: EXCLUDED as any },
            },
          }),
        ])
        return {
          storeId: store.id,
          name: store.name,
          platform: store.platform,
          domain: store.domain,
          revenue: Number(agg._sum.total ?? 0),
          orders: count,
          commissions: Number(comm._sum.amount ?? 0),
        }
      }),
    )
    return results.sort((a, b) => b.revenue - a.revenue)
  }

  /** Top products by line revenue (unitPrice × qty) in range. */
  async byProduct(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
    limit = 10,
  ) {
    const { from, to } = parseRange(rangeInput)
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 5000) : 10
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          store: { organizationId },
          placedAt: { gte: from, lte: to },
        },
        productId: { not: null },
      },
      include: {
        product: { select: { id: true, name: true, sku: true, categoryId: true, storeId: true } },
      },
      take: 20_000,
    })

    const map = new Map<
      string,
      {
        productId: string
        name: string
        sku: string | null
        categoryId: string | null
        storeId: string
        quantity: number
        revenue: number
        commissionAmount: number
      }
    >()

    for (const it of items) {
      if (!it.product) continue
      const key = it.product.id
      const lineRev = Number(it.unitPrice) * it.quantity
      const cur = map.get(key) ?? {
        productId: it.product.id,
        name: it.product.name,
        sku: it.product.sku,
        categoryId: it.product.categoryId,
        storeId: it.product.storeId,
        quantity: 0,
        revenue: 0,
        commissionAmount: 0,
      }
      cur.quantity += it.quantity
      cur.revenue += lineRev
      cur.commissionAmount += Number(it.commissionAmount)
      map.set(key, cur)
    }

    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, safeLimit)
  }

  /** Category rollup from product line items. */
  async byCategory(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const products = await this.byProduct(organizationId, rangeInput, 5000)
    const catIds = [...new Set(products.map((p) => p.categoryId).filter(Boolean))] as string[]
    const cats = catIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: catIds }, organizationId },
          select: { id: true, name: true },
        })
      : []
    const nameById = new Map(cats.map((c) => [c.id, c.name]))

    const map = new Map<
      string,
      { categoryId: string | null; name: string; quantity: number; revenue: number; commissionAmount: number }
    >()
    for (const p of products) {
      const key = p.categoryId ?? '__uncategorized__'
      const cur = map.get(key) ?? {
        categoryId: p.categoryId,
        name: p.categoryId ? nameById.get(p.categoryId) ?? p.categoryId : 'Uncategorized',
        quantity: 0,
        revenue: 0,
        commissionAmount: 0,
      }
      cur.quantity += p.quantity
      cur.revenue += p.revenue
      cur.commissionAmount += p.commissionAmount
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }

  /**
   * Orders grouped by traffic source: paid vs organic, ad network (Meta /
   * Google / TikTok …) and utm_source. Orders with no captured signal fall
   * into the 'direct' bucket. This is what powers the "where did this sale come
   * from" breakdown so orders no longer all show as Direct.
   */
  async bySource(
    organizationId: string,
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const { from, to } = parseRange(rangeInput)
    const orders = await this.prisma.order.findMany({
      where: { store: { organizationId }, placedAt: { gte: from, lte: to } },
      select: {
        total: true,
        trafficChannel: true,
        adNetwork: true,
        utmSource: true,
        utmCampaign: true,
        affiliateId: true,
      },
    })

    const map = new Map<
      string,
      {
        channel: string
        adNetwork: string | null
        source: string | null
        orders: number
        revenue: number
        attributedOrders: number
      }
    >()
    for (const o of orders) {
      const channel = o.trafficChannel || 'direct'
      const adNetwork = o.adNetwork || null
      const source = o.utmSource || null
      const key = `${channel}|${adNetwork ?? ''}|${source ?? ''}`
      const cur =
        map.get(key) ??
        { channel, adNetwork, source, orders: 0, revenue: 0, attributedOrders: 0 }
      cur.orders += 1
      cur.revenue += Number(o.total)
      if (o.affiliateId) cur.attributedOrders += 1
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }

  async exportCsv(
    organizationId: string,
    entity: 'commissions' | 'orders' | 'affiliates',
    rangeInput: { days?: number; from?: string; to?: string } = {},
  ) {
    const { from, to } = parseRange(rangeInput)

    if (entity === 'orders') {
      const rows = await this.prisma.order.findMany({
        where: { store: { organizationId }, placedAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      })
      return buildCsv(
        ['externalOrderId', 'status', 'currency', 'subtotal', 'total', 'refundAmount', 'affiliateId', 'placedAt'],
        rows.map((r) => [
          r.externalOrderId,
          r.status,
          r.currency,
          String(r.subtotal),
          String(r.total),
          String(r.refundAmount),
          r.affiliateId ?? '',
          r.placedAt?.toISOString() ?? '',
        ]),
      )
    }

    if (entity === 'affiliates') {
      const top = await this.topAffiliates(organizationId, 500, rangeInput)
      return buildCsv(
        ['affiliateCode', 'commissions', 'orders', 'revenue', 'clicks', 'epc', 'conversionRate'],
        top.map((r) => [
          r.affiliateCode,
          r.total,
          r.orders,
          r.revenue,
          r.clicks,
          r.epc.toFixed(4),
          r.conversionRate.toFixed(4),
        ]),
      )
    }

    const rows = await this.prisma.commission.findMany({
      where: {
        affiliate: { organizationId },
        createdAt: { gte: from, lte: to },
      },
      include: { affiliate: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
    return buildCsv(
      ['id', 'affiliateCode', 'amount', 'currency', 'status', 'createdAt'],
      rows.map((r) => [
        r.id,
        r.affiliate.affiliateCode,
        String(r.amount),
        r.currency,
        r.status,
        r.createdAt.toISOString(),
      ]),
    )
  }
}
