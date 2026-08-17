import { NotFoundException } from '@nestjs/common'
import { OrdersService } from './orders.service'

function makeService() {
  const prisma: any = {
    store: { findFirst: jest.fn() },
    customer: { upsert: jest.fn(), create: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    order: { upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    click: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  }
  const attribution: any = { resolve: jest.fn() }
  const commissions: any = { generateForOrder: jest.fn(), generateSplitForOrder: jest.fn(), handleRefund: jest.fn() }
  const fraud: any = { checkOrder: jest.fn(), createReview: jest.fn() }
  return { service: new OrdersService(prisma, attribution, commissions, fraud), prisma, attribution, commissions, fraud }
}

const dto: any = { storeId: 'store-1', externalOrderId: 'EXT-1', subtotal: 100, total: 100, currency: 'USD', customerEmail: 'buyer@example.com', referralCode: 'REF1' }

function prepare(prisma: any) {
  prisma.store.findFirst.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' })
  prisma.customer.upsert.mockResolvedValue({ id: 'cust-1' })
  prisma.order.upsert.mockResolvedValue({ id: 'ord-1', storeId: 'store-1', currency: 'USD' })
}

describe('OrdersService', () => {
  it('throws when store is missing', async () => {
    const { service, prisma } = makeService(); prisma.store.findFirst.mockResolvedValue(null)
    await expect(service.ingest('org-1', dto)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('skips commission without attribution', async () => {
    const { service, prisma, attribution, commissions } = makeService(); prepare(prisma); attribution.resolve.mockResolvedValue(null)
    const result = await service.ingest('org-1', dto)
    expect(result.commission).toBeNull(); expect(commissions.generateForOrder).not.toHaveBeenCalled()
  })

  it('generates commission when fraud allows', async () => {
    const { service, prisma, attribution, commissions, fraud } = makeService(); prepare(prisma)
    attribution.resolve.mockResolvedValue({ affiliateId: 'aff-1', method: 'cookie', model: 'last_click', clickId: 'clk-1', shares: [{ affiliateId: 'aff-1', weight: 1 }] })
    fraud.checkOrder.mockResolvedValue({ decision: 'allow', score: 0, reasons: [], signals: [], blocked: false })
    commissions.generateForOrder.mockResolvedValue({ id: 'comm-1', amount: 10 })
    await expect(service.ingest('org-1', dto)).resolves.toMatchObject({ commission: { id: 'comm-1' } })
    expect(prisma.click.findUnique).toHaveBeenCalledWith({ where: { id: 'clk-1' } })
  })

  it('queues review and skips commission', async () => {
    const { service, prisma, attribution, commissions, fraud } = makeService(); prepare(prisma)
    attribution.resolve.mockResolvedValue({ affiliateId: 'aff-1', method: 'cookie', model: 'last_click', shares: [{ affiliateId: 'aff-1', weight: 1 }] })
    fraud.checkOrder.mockResolvedValue({ decision: 'review', score: 50, reasons: [], signals: [], blocked: false })
    fraud.createReview.mockResolvedValue({ id: 'fr-1' })
    const result = await service.ingest('org-1', dto)
    expect(result.commission).toBeNull(); expect(commissions.generateForOrder).not.toHaveBeenCalled()
  })

  it('updates refunds', async () => {
    const { service, prisma, commissions } = makeService()
    prisma.order.findFirst.mockResolvedValue({ id: 'ord-1', total: 100 })
    prisma.order.update.mockResolvedValue({ id: 'ord-1', refundAmount: 25 })
    await expect(service.refund('org-1', 'ord-1', 25)).resolves.toMatchObject({ refundAmount: 25 })
    expect(commissions.handleRefund).toHaveBeenCalled()
  })

  it('returns paged orders', async () => {
    const { service, prisma } = makeService(); prisma.order.findMany.mockResolvedValue([{ id: 'o1' }]); prisma.order.count.mockResolvedValue(1)
    await expect(service.list('org-1', { skip: 0, take: 10 })).resolves.toEqual({ items: [{ id: 'o1' }], total: 1 })
  })
})
