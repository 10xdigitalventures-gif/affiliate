import { ReportsService } from './reports.service'

function makeService() {
  const prisma: any = {
    order: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    commission: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    affiliate: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    click: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    store: { findMany: jest.fn() },
    orderItem: { findMany: jest.fn() },
    category: { findMany: jest.fn() },
  }
  return { service: new ReportsService(prisma), prisma }
}

describe('ReportsService.summary', () => {
  it('includes EPC, conversion rate, AOV', async () => {
    const { service, prisma } = makeService()
    prisma.order.aggregate.mockResolvedValue({ _sum: { total: 1000 }, _avg: { total: 100 } })
    prisma.commission.aggregate.mockResolvedValue({ _sum: { amount: 100 } })
    prisma.affiliate.count.mockResolvedValue(3)
    prisma.order.count
      .mockResolvedValueOnce(10) // all orders
      .mockResolvedValueOnce(5) // attributed
    prisma.click.count.mockResolvedValue(50)

    const res = await service.summary('org-1', { days: 30 })
    expect(res.revenue).toBe(1000)
    expect(res.commissions).toBe(100)
    expect(res.orders).toBe(10)
    expect(res.clicks).toBe(50)
    expect(res.attributedOrders).toBe(5)
    expect(res.aov).toBe(100)
    expect(res.epc).toBeCloseTo(2) // 100/50
    expect(res.conversionRate).toBeCloseTo(0.1) // 5/50
    expect(res.commissionRate).toBeCloseTo(0.1)
    expect(res.range.days).toBeGreaterThanOrEqual(1)
  })

  it('accepts custom from/to range', async () => {
    const { service, prisma } = makeService()
    prisma.order.aggregate.mockResolvedValue({ _sum: { total: 0 }, _avg: { total: null } })
    prisma.commission.aggregate.mockResolvedValue({ _sum: { amount: null } })
    prisma.affiliate.count.mockResolvedValue(0)
    prisma.order.count.mockResolvedValue(0)
    prisma.click.count.mockResolvedValue(0)

    const res = await service.summary('org-1', { from: '2026-01-01', to: '2026-01-31' })
    expect(res.range.from.startsWith('2026-01-01')).toBe(true)
    expect(res.revenue).toBe(0)
  })

  it('rejects invalid or excessive ranges before querying the database', () => {
    const { service, prisma } = makeService()

    expect(() => service.resolveRange({ days: Number.NaN })).toThrow('positive number')
    expect(() => service.resolveRange({ days: 367 })).toThrow('cannot exceed 366 days')
    expect(() => service.resolveRange({ from: '2026-02-01', to: '2026-01-01' })).toThrow('must not be after')
    expect(prisma.order.findMany).not.toHaveBeenCalled()
  })
})

describe('ReportsService.timeseries', () => {
  it('buckets revenue, commissions, orders, clicks', async () => {
    const { service, prisma } = makeService()
    const today = new Date()
    const key = today.toISOString().slice(0, 10)
    prisma.order.findMany.mockResolvedValue([{ total: 100, placedAt: today, affiliateId: 'a1' }])
    prisma.commission.findMany.mockResolvedValue([{ amount: 10, createdAt: today }])
    prisma.click.findMany.mockResolvedValue([{ occurredAt: today }])

    const series = await service.timeseries('org-1', { days: 7 })
    expect(series).toHaveLength(7)
    const day = series.find((d) => d.date === key)
    expect(day?.revenue).toBe(100)
    expect(day?.commissions).toBe(10)
    expect(day?.orders).toBe(1)
    expect(day?.clicks).toBe(1)
  })
})

describe('ReportsService.topAffiliates', () => {
  it('includes epc and conversion metrics', async () => {
    const { service, prisma } = makeService()
    prisma.commission.groupBy.mockResolvedValue([
      { affiliateId: 'a1', _sum: { amount: 40 }, _count: { _all: 4 } },
    ])
    prisma.affiliate.findMany.mockResolvedValue([{ id: 'a1', affiliateCode: 'TOP1' }])
    prisma.order.groupBy.mockResolvedValue([
      { affiliateId: 'a1', _count: { _all: 2 }, _sum: { total: 200 } },
    ])
    prisma.click.groupBy.mockResolvedValue([{ affiliateId: 'a1', _count: { _all: 20 } }])

    const res = await service.topAffiliates('org-1', 5, { days: 30 })
    expect(res[0]).toMatchObject({
      affiliateCode: 'TOP1',
      total: 40,
      orders: 2,
      revenue: 200,
      clicks: 20,
    })
    expect(res[0].epc).toBeCloseTo(2)
    expect(res[0].conversionRate).toBeCloseTo(0.1)
  })
})

describe('ReportsService.byStore / byProduct / byCategory', () => {
  it('byStore aggregates per store', async () => {
    const { service, prisma } = makeService()
    prisma.store.findMany.mockResolvedValue([
      { id: 's1', name: 'Shop A', platform: 'shopify', domain: 'a.myshopify.com' },
    ])
    prisma.order.aggregate.mockResolvedValue({ _sum: { total: 300 } })
    prisma.order.count.mockResolvedValue(3)
    prisma.commission.aggregate.mockResolvedValue({ _sum: { amount: 30 } })

    const res = await service.byStore('org-1', { days: 30 })
    expect(res).toEqual([
      expect.objectContaining({
        storeId: 's1',
        name: 'Shop A',
        revenue: 300,
        orders: 3,
        commissions: 30,
      }),
    ])
  })

  it('byProduct rolls up line items', async () => {
    const { service, prisma } = makeService()
    prisma.orderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        unitPrice: 10,
        commissionAmount: 2,
        product: { id: 'p1', name: 'Widget', sku: 'W1', categoryId: 'cat1', storeId: 's1' },
      },
      {
        quantity: 1,
        unitPrice: 10,
        commissionAmount: 1,
        product: { id: 'p1', name: 'Widget', sku: 'W1', categoryId: 'cat1', storeId: 's1' },
      },
    ])

    const res = await service.byProduct('org-1', { days: 30 }, 10)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      productId: 'p1',
      name: 'Widget',
      quantity: 3,
      revenue: 30,
      commissionAmount: 3,
    })
  })

  it('byCategory groups product revenue', async () => {
    const { service, prisma } = makeService()
    prisma.orderItem.findMany.mockResolvedValue([
      {
        quantity: 1,
        unitPrice: 50,
        commissionAmount: 5,
        product: { id: 'p1', name: 'A', sku: null, categoryId: 'cat1', storeId: 's1' },
      },
      {
        quantity: 1,
        unitPrice: 20,
        commissionAmount: 2,
        product: { id: 'p2', name: 'B', sku: null, categoryId: null, storeId: 's1' },
      },
    ])
    prisma.category.findMany.mockResolvedValue([{ id: 'cat1', name: 'Gadgets' }])

    const res = await service.byCategory('org-1', { days: 30 })
    expect(res.find((c) => c.categoryId === 'cat1')?.name).toBe('Gadgets')
    expect(res.find((c) => c.categoryId === null)?.name).toBe('Uncategorized')
  })
})

describe('ReportsService.exportCsv', () => {
  it('exports orders with affiliateId column', async () => {
    const { service, prisma } = makeService()
    prisma.order.findMany.mockResolvedValue([
      {
        externalOrderId: 'E1',
        status: 'paid',
        currency: 'USD',
        subtotal: 10,
        total: 12,
        refundAmount: 0,
        affiliateId: 'a1',
        placedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    const csv = await service.exportCsv('org-1', 'orders', { days: 30 })
    expect(csv).toContain('affiliateId')
    expect(csv).toContain('E1')
  })
})
