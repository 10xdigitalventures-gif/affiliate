import { UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { WebhooksService } from './webhooks.service'

const uniqueConflict = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  })

function makeService() {
  const prisma: any = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  const stores: any = {
    getForWebhook: jest.fn(),
    recordSync: jest.fn(async () => undefined),
  }
  const orders: any = {
    ingest: jest.fn(async () => ({ order: { id: 'o1' } })),
    refundByExternal: jest.fn(async () => ({ id: 'o1' })),
  }
  const shopify: any = {
    verifyWebhook: jest.fn(() => true),
    mapOrder: jest.fn(() => ({ storeId: 's1', externalOrderId: '1', subtotal: 10 })),
    refundOrderId: jest.fn(() => '1'),
    refundAmount: jest.fn(() => 5),
  }
  const woo: any = {
    verifyWebhook: jest.fn(() => true),
    mapOrder: jest.fn(() => ({ storeId: 's1', externalOrderId: '2', subtotal: 20 })),
    refundOrderId: jest.fn(() => '2'),
    refundAmount: jest.fn(() => 3),
  }
  const ghl: any = {
    verifyWebhook: jest.fn(() => true),
    mapOrder: jest.fn(() => ({ storeId: 's1', externalOrderId: '3', subtotal: 30 })),
    refundOrderId: jest.fn(() => '3'),
    refundAmount: jest.fn(() => 1),
  }
  const queue: any = { addRetry: jest.fn(async () => undefined) }
  const service = new WebhooksService(prisma, stores, orders, shopify, woo, ghl, queue)
  return { service, prisma, stores, orders, shopify, woo, queue }
}

describe('WebhooksService.handleShopify', () => {
  const body = Buffer.from(JSON.stringify({ id: 99, total_price: '10.00' }))

  it('returns unknown store when missing', async () => {
    const { service, stores } = makeService()
    stores.getForWebhook.mockResolvedValue(null)
    await expect(service.handleShopify('s1', {}, body)).resolves.toEqual({ ok: false, reason: 'unknown store' })
  })

  it('rejects invalid signature in production when secret set', async () => {
    const { service, stores, shopify } = makeService()
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: 'sec',
    })
    shopify.verifyWebhook.mockReturnValue(false)
    await expect(
      service.handleShopify('s1', { 'x-shopify-hmac-sha256': 'bad' }, body),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    process.env.NODE_ENV = prev
  })

  it('dedupes already-processed events', async () => {
    const { service, stores, prisma, orders } = makeService()
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: null,
    })
    prisma.webhookEvent.create.mockRejectedValue(uniqueConflict())
    prisma.webhookEvent.findUnique.mockResolvedValue({ id: 'e1', status: 'processed' })

    const res = await service.handleShopify(
      's1',
      { 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'w1' },
      body,
    )
    expect(res).toEqual({ ok: true, deduped: true })
    expect(orders.ingest).not.toHaveBeenCalled()
  })

  it('ingests order topics and marks processed', async () => {
    const { service, stores, prisma, orders } = makeService()
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: null,
    })
    prisma.webhookEvent.create.mockResolvedValue({ id: 'e1', status: 'processing' })
    prisma.webhookEvent.update.mockResolvedValue({ id: 'e1', status: 'processed', attempts: 1 })

    const res = await service.handleShopify(
      's1',
      { 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'w2' },
      body,
    )
    expect(res).toEqual({ ok: true, topic: 'orders/create' })
    expect(orders.ingest).toHaveBeenCalled()
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }),
    )
  })

  it('handles refund topics via refundByExternal', async () => {
    const { service, stores, prisma, orders } = makeService()
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: null,
    })
    prisma.webhookEvent.create.mockResolvedValue({ id: 'e2', status: 'processing' })
    prisma.webhookEvent.update.mockResolvedValue({ id: 'e2', status: 'processed', attempts: 1 })

    await service.handleShopify(
      's1',
      { 'x-shopify-topic': 'refunds/create', 'x-shopify-webhook-id': 'w3' },
      body,
    )
    expect(orders.refundByExternal).toHaveBeenCalled()
    expect(orders.ingest).not.toHaveBeenCalled()
  })

  it('marks failed and schedules retry on ingest error', async () => {
    const { service, stores, prisma, orders, queue } = makeService()
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: null,
    })
    prisma.webhookEvent.create.mockResolvedValue({ id: 'e3', status: 'processing' })
    prisma.webhookEvent.update.mockResolvedValue({ id: 'e3', status: 'failed', attempts: 1 })
    orders.ingest.mockRejectedValue(new Error('boom'))

    await expect(
      service.handleShopify(
        's1',
        { 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'w4' },
        body,
      ),
    ).rejects.toThrow('boom')
    expect(queue.addRetry).toHaveBeenCalledWith('e3', 0)
  })

  it('does not double-process a delivery with an active processing lease', async () => {
    const { service, stores, prisma, orders } = makeService()
    stores.getForWebhook.mockResolvedValue({
      store: { id: 's1', organizationId: 'org-1' },
      webhookSecret: null,
    })
    prisma.webhookEvent.create.mockRejectedValue(uniqueConflict())
    prisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'e4',
      status: 'processing',
      processingStartedAt: new Date(),
    })
    prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 })

    const result = await service.handleShopify(
      's1',
      { 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'w5' },
      body,
    )

    expect(result).toEqual({ ok: true, deduped: true })
    expect(orders.ingest).not.toHaveBeenCalled()
  })
})
