import { CatalogService } from './catalog.service'
import { ShopifyService } from '../integrations/shopify.service'
import { WooCommerceService } from '../integrations/woocommerce.service'
import { GhlService } from '../integrations/ghl.service'

function makeService() {
  const prisma: any = {
    store: { findFirst: jest.fn(), count: jest.fn(), update: jest.fn() },
    product: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    category: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    syncJob: { create: jest.fn(), update: jest.fn() },
    $transaction: (ops: any[]) => Promise.all(ops),
  }
  const service = new CatalogService(
    prisma,
    new ShopifyService(),
    new WooCommerceService(),
    new GhlService(),
  )
  return { service, prisma }
}

describe('CatalogService.listProducts', () => {
  it('scopes to org and applies store/status/search filters', async () => {
    const { service, prisma } = makeService()
    prisma.product.findMany.mockResolvedValue([{ id: 'p1' }])
    prisma.product.count.mockResolvedValue(1)

    const res = await service.listProducts('org-1', { storeId: 's1', status: 'active', search: 'shirt', take: 10 })

    expect(res.total).toBe(1)
    const arg = prisma.product.findMany.mock.calls[0][0]
    expect(arg.where.store).toEqual({ organizationId: 'org-1' })
    expect(arg.where.storeId).toBe('s1')
    expect(arg.where.status).toBe('active')
    expect(arg.where.OR).toHaveLength(3)
    expect(arg.take).toBe(10)
  })
})

describe('CatalogService.upsertProduct', () => {
  it('creates a category when it does not exist and upserts by (storeId, externalId)', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1', platform: 'shopify' })
    prisma.category.findFirst.mockResolvedValue(null)
    prisma.category.create.mockResolvedValue({ id: 'c1', name: 'Shoes' })
    prisma.product.upsert.mockResolvedValue({ id: 'p1' })

    await service.upsertProduct('org-1', 's1', { externalId: 'ext-1', name: 'Runner', price: 50, categoryName: 'Shoes' })

    expect(prisma.category.create).toHaveBeenCalled()
    const arg = prisma.product.upsert.mock.calls[0][0]
    expect(arg.where.storeId_externalId).toEqual({ storeId: 's1', externalId: 'ext-1' })
    expect(arg.create.categoryId).toBe('c1')
    expect(arg.update.name).toBe('Runner')
  })

  it('reuses an existing category and defaults status to active', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1', platform: 'woocommerce' })
    prisma.category.findFirst.mockResolvedValue({ id: 'c9', name: 'Shoes' })
    prisma.product.upsert.mockResolvedValue({ id: 'p1' })

    await service.upsertProduct('org-1', 's1', { externalId: 'ext-2', name: 'Boot', price: 80, categoryName: 'Shoes' })

    expect(prisma.category.create).not.toHaveBeenCalled()
    const arg = prisma.product.upsert.mock.calls[0][0]
    expect(arg.create.categoryId).toBe('c9')
    expect(arg.create.status).toBe('active')
  })
})

describe('CatalogService.syncCatalog', () => {
  it('maps raw shopify payloads, counts created vs updated, and marks the job success', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1', platform: 'shopify' })
    prisma.syncJob.create.mockResolvedValue({ id: 'job1' })
    prisma.category.findFirst.mockResolvedValue(null)
    prisma.category.create.mockResolvedValue({ id: 'c1' })
    // first product new, second existing
    prisma.product.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p-existing' })
    prisma.product.upsert.mockResolvedValue({ id: 'p' })

    const res = await service.syncCatalog('org-1', 's1', {
      products: [
        { id: 1, title: 'A', status: 'active', product_type: 'Tops', variants: [{ price: '10', sku: 'A1' }] },
        { id: 2, title: 'B', status: 'draft', variants: [{ price: '20' }] },
      ],
    })

    expect(res.total).toBe(2)
    expect(res.created).toBe(1)
    expect(res.updated).toBe(1)
    expect(prisma.syncJob.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { status: 'success' } })
    expect(prisma.store.update).toHaveBeenCalled()
  })

  it('accepts already-normalised products and skips invalid rows', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1', platform: 'shopify' })
    prisma.syncJob.create.mockResolvedValue({ id: 'job2' })
    prisma.category.findFirst.mockResolvedValue(null)
    prisma.product.findUnique.mockResolvedValue(null)
    prisma.product.upsert.mockResolvedValue({ id: 'p' })

    const res = await service.syncCatalog('org-1', 's1', {
      normalized: true,
      products: [
        { externalId: 'x1', name: 'Valid', price: 5 } as any,
        { name: 'Missing external id', price: 5 } as any,
        { externalId: 'x2', name: 'Negative price', price: -1 } as any,
      ],
    })

    expect(res.created).toBe(1)
    expect(res.skipped).toBe(2)
  })

  it('marks the job failed when an upsert throws', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1', platform: 'shopify' })
    prisma.syncJob.create.mockResolvedValue({ id: 'job3' })
    prisma.category.findFirst.mockResolvedValue(null)
    prisma.product.findUnique.mockResolvedValue(null)
    prisma.product.upsert.mockRejectedValue(new Error('db down'))

    await expect(
      service.syncCatalog('org-1', 's1', { normalized: true, products: [{ externalId: 'x1', name: 'V', price: 1 } as any] }),
    ).rejects.toThrow('db down')
    expect(prisma.syncJob.update).toHaveBeenCalledWith({ where: { id: 'job3' }, data: { status: 'failed' } })
  })
})

describe('integration mapProduct', () => {
  it('shopify maps variant price/sku and draft -> inactive', () => {
    const p = new ShopifyService().mapProduct('s1', { id: 5, title: 'Tee', status: 'draft', product_type: 'Tops', variants: [{ price: '12.50', sku: 'TEE' }] })
    expect(p.externalId).toBe('5')
    expect(p.price).toBe(12.5)
    expect(p.sku).toBe('TEE')
    expect(p.status).toBe('inactive')
    expect(p.categoryName).toBe('Tops')
  })

  it('woocommerce maps first category and publish -> active', () => {
    const p = new WooCommerceService().mapProduct('s1', { id: 9, name: 'Mug', price: '8', status: 'publish', categories: [{ id: 3, name: 'Kitchen' }] })
    expect(p.status).toBe('active')
    expect(p.categoryName).toBe('Kitchen')
    expect(p.categoryExternalId).toBe('3')
  })
})
