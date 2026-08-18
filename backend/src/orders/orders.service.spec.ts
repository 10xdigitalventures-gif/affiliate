import { NotFoundException } from '@nestjs/common'
import { OrdersService } from './orders.service'

/**
 * Attribution, commissions, fraud, and Prisma are stubbed.
 * Asserts ingest path (allow / review / multi-touch), refunds, list.
 */
function makeService() {
  const prisma: any = {
    store: { findFirst: jest.fn() },
    customer: {
      upsert: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    order: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    click: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  }
  const attribution: any = { resolve: jest.fn() }
  const commissions: any = {
    generateForOrder: jest.fn(),
    generateSplitForOrder: jest.fn(),
    handleRefund: jest.fn(async () => undefined),
  }
  const fraud: any = {
    checkOrder: jest.fn(),
    createReview: jest.fn(),
  }
  const service = new OrdersService(prisma, attribution, commissions, fraud)
  return { service, prisma, attribution, commissions, fraud }
}

const dto = {
  storeId: 'store-1',
  externalOrderId: 'EXT-1',
  subtotal: 100,
  total: 100,
  currency: 'USD',
  customerEmail: 'buyer@example.com',
  referralCode: 'REF1',
}

describe('OrdersService.ingest', () => {
  it('throws when store is missing', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue(null)
    await expect(service.ingest('org-1', dto as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('ingests without attribution and skips commission', async () => {
    const { service, prisma, attribution, commissions } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' })
    prisma.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    attribution.resolve.mockResolvedValue(null)
    prisma.order.upsert.mockResolvedValue({
      id: 'ord-1',
      storeId: 'store-1',
      currency: 'USD',
    })

    const res = await service.ingest('org-1', dto as any)
    expect(res.order.id).toBe('ord-1')
    expect(res.attribution).toBeNull()
    expect(res.commission).toBeNull()
    expect(res.fraud).toBeNull()
    expect(commissions.generateForOrder).not.toHaveBeenCalled()
  })

  it('generates commission when fraud allows', async () => {
    const { service, prisma, attribution, commissions, fraud } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' })
    prisma.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    attribution.resolve.mockResolvedValue({
      affiliateId: 'aff-1',
      method: 'cookie',
      model: 'last_click',
      clickId: 'clk-1',
      shares: [{ affiliateId: 'aff-1', weight: 1, role: 'only' }],
    })
    prisma.order.upsert.mockResolvedValue({
      id: 'ord-1',
      storeId: 'store-1',
      currency: 'USD',
    })
    fraud.checkOrder.mockResolvedValue({ decision: 'allow', score: 0, reasons: [], signals: [], blocked: false })
    commissions.generateForOrder.mockResolvedValue({ id: 'comm-1', amount: 10 })

    const res = await service.ingest('org-1', dto as any)
    expect(res.commission).toEqual({ id: 'comm-1', amount: 10 })
    expect(res.fraud?.decision).toBe('allow')
    expect(commissions.generateForOrder).toHaveBeenCalled()
    expect(prisma.customer.updateMany).toHaveBeenCalled()
  })

  it('queues fraud review and skips commission on review decision', async () => {
    const { service, prisma, attribution, commissions, fraud } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' })
    prisma.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    attribution.resolve.mockResolvedValue({
      affiliateId: 'aff-1',
      method: 'cookie',
      model: 'last_click',
      shares: [{ affiliateId: 'aff-1', weight: 1 }],
    })
    prisma.order.upsert.mockResolvedValue({ id: 'ord-1', storeId: 'store-1', currency: 'USD' })
    fraud.checkOrder.mockResolvedValue({
      decision: 'review',
      score: 50,
      reasons: ['order_velocity'],
      signals: [],
      blocked: false,
    })
    fraud.createReview.mockResolvedValue({ id: 'fr-1' })

    const res = await service.ingest('org-1', dto as any)
    expect(res.commission).toBeNull()
    expect(res.fraud).toMatchObject({ decision: 'review', reviewId: 'fr-1', score: 50 })
    expect(commissions.generateForOrder).not.toHaveBeenCalled()
    expect(fraud.createReview).toHaveBeenCalled()
  })

  it('uses multi-touch split when model is linear with multiple shares', async () => {
    const { service, prisma, attribution, commissions, fraud } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' })
    prisma.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    attribution.resolve.mockResolvedValue({
      affiliateId: 'aff-a',
      method: 'cookie',
      model: 'linear',
      shares: [
        { affiliateId: 'aff-a', weight: 0.5 },
        { affiliateId: 'aff-b', weight: 0.5 },
      ],
    })
    prisma.order.upsert.mockResolvedValue({ id: 'ord-1', storeId: 'store-1', currency: 'USD' })
    fraud.checkOrder.mockResolvedValue({ decision: 'allow', score: 0, reasons: [], signals: [], blocked: false })
    commissions.generateSplitForOrder.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])

    const res = await service.ingest('org-1', dto as any)
    expect(commissions.generateSplitForOrder).toHaveBeenCalled()
    expect(commissions.generateForOrder).not.toHaveBeenCalled()
    expect(res.commission).toEqual({ id: 'c1' })
  })
})

describe('OrdersService.refund', () => {
  it('throws when order not found', async () => {
    const { service, prisma } = makeService()
    prisma.order.findFirst.mockResolvedValue(null)
    await expect(service.refund('org-1', 'missing', 10)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('updates refund amount and calls handleRefund', async () => {
    const { service, prisma, commissions } = makeService()
    prisma.order.findFirst.mockResolvedValue({ id: 'ord-1', total: 100 })
    prisma.order.update.mockResolvedValue({ id: 'ord-1', total: 100, refundAmount: 25 })

    const res = await service.refund('org-1', 'ord-1', 25)
    expect(res.refundAmount).toBe(25)
    expect(commissions.handleRefund).toHaveBeenCalled()
  })

  it('refundByExternal returns null when order missing', async () => {
    const { service, prisma } = makeService()
    prisma.order.findFirst.mockResolvedValue(null)
    await expect(service.refundByExternal('org-1', 'store-1', 'X', 5)).resolves.toBeNull()
  })
})

describe('OrdersService.list', () => {
  it('returns paged items + total', async () => {
    const { service, prisma } = makeService()
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }])
    prisma.order.count.mockResolvedValue(1)
    const res = await service.list('org-1', { skip: 0, take: 10 })
    expect(res).toEqual({ items: [{ id: 'o1' }], total: 1 })
  })
})
