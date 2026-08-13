import { ConflictException, NotFoundException } from '@nestjs/common'
import { LinksService } from './links.service'

function makeService() {
  const prisma: any = {
    affiliate: { findFirst: jest.fn() },
    affiliateLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    click: { count: jest.fn() },
    $transaction: (ops: any[]) => Promise.all(ops),
  }
  const domains: any = { trackingBaseUrl: jest.fn().mockResolvedValue(null) }
  return { service: new LinksService(prisma, domains), prisma }
}

describe('LinksService.create', () => {
  it('throws when affiliate missing', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue(null)
    await expect(service.create('org-1', { affiliateId: 'a1', destinationUrl: 'https://x.test' } as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('creates link with generated shortCode and full shortUrl', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.affiliateLink.findUnique.mockResolvedValue(null)
    prisma.affiliateLink.create.mockImplementation(({ data }: any) => ({ id: 'l1', clicksCount: 0n, ...data }))
    const res = await service.create('org-1', { affiliateId: 'a1', destinationUrl: 'https://shop.example', storeId: 's1' } as any)
    expect(res.affiliateId).toBe('a1')
    expect(res.shortCode).toEqual(expect.any(String))
    expect(res.shortUrl).toContain('/track/r/')
    expect(res.clicksCount).toBe(0)
  })

  it('rejects a custom shortCode already in use', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.affiliateLink.findUnique.mockResolvedValue({ id: 'existing' })
    await expect(
      service.create('org-1', { affiliateId: 'a1', destinationUrl: 'https://x.test', shortCode: 'promo' } as any),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('LinksService.list', () => {
  it('scopes to org and applies filters, decorating each link', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findMany.mockResolvedValue([{ id: 'l1', shortCode: 'abc', clicksCount: 3n }])
    const res = await service.list('org-1', { campaignId: 'cmp1', search: 'shop' })
    const arg = prisma.affiliateLink.findMany.mock.calls[0][0]
    expect(arg.where.affiliate).toEqual({ organizationId: 'org-1' })
    expect(arg.where.campaignId).toBe('cmp1')
    expect(arg.where.OR).toHaveLength(2)
    expect(res[0].clicksCount).toBe(3)
    expect(res[0].shortUrl).toContain('/track/r/abc')
  })
})

describe('LinksService.update', () => {
  it('detaches store/campaign when passed empty', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findFirst.mockResolvedValue({ id: 'l1' })
    prisma.affiliateLink.update.mockResolvedValue({ id: 'l1', shortCode: 'abc', clicksCount: 0n })
    await service.update('org-1', 'l1', { storeId: '', campaignId: '' })
    const data = prisma.affiliateLink.update.mock.calls[0][0].data
    expect(data.storeId).toBeNull()
    expect(data.campaignId).toBeNull()
  })

  it('throws when link not found', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findFirst.mockResolvedValue(null)
    await expect(service.update('org-1', 'x', { destinationUrl: 'https://y.test' })).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('LinksService.remove', () => {
  it('blocks deletion when the link has recorded clicks', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findFirst.mockResolvedValue({ id: 'l1' })
    prisma.click.count.mockResolvedValue(4)
    await expect(service.remove('org-1', 'l1')).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.affiliateLink.delete).not.toHaveBeenCalled()
  })

  it('deletes when there are no clicks', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findFirst.mockResolvedValue({ id: 'l1' })
    prisma.click.count.mockResolvedValue(0)
    prisma.affiliateLink.delete.mockResolvedValue({ id: 'l1' })
    const res = await service.remove('org-1', 'l1')
    expect(res).toEqual({ id: 'l1', deleted: true })
  })
})

describe('LinksService.stats', () => {
  it('sums clicks across links', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.count.mockResolvedValue(12)
    prisma.affiliateLink.aggregate.mockResolvedValue({ _sum: { clicksCount: 340n } })
    const res = await service.stats('org-1')
    expect(res).toEqual({ total: 12, totalClicks: 340 })
  })
})

describe('LinksService.listForAffiliate', () => {
  it('throws when affiliate missing', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue(null)
    await expect(service.listForAffiliate('org-1', 'a1')).rejects.toBeInstanceOf(NotFoundException)
  })
})
