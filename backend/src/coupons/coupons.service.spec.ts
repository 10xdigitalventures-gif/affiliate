import { NotFoundException } from '@nestjs/common'
import { CouponsService } from './coupons.service'

function makeService() {
  const prisma: any = {
    store: { findFirst: jest.fn() },
    affiliate: { findFirst: jest.fn() },
    coupon: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: (ops: any[]) => Promise.all(ops),
  }
  return { service: new CouponsService(prisma), prisma }
}

describe('CouponsService.create', () => {
  it('throws when store missing', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue(null)
    await expect(service.create('org-1', { storeId: 's1', code: 'SAVE10' } as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws when affiliate missing', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1' })
    prisma.affiliate.findFirst.mockResolvedValue(null)
    await expect(service.create('org-1', { storeId: 's1', code: 'SAVE10', affiliateId: 'a1' } as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('creates active coupon', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1' })
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.coupon.create.mockResolvedValue({ id: 'c1', code: 'SAVE10', status: 'active' })
    const res = await service.create('org-1', { storeId: 's1', code: 'SAVE10', affiliateId: 'a1', discountType: 'percentage' } as any)
    expect(res.status).toBe('active')
    expect(prisma.coupon.create.mock.calls[0][0].data.code).toBe('SAVE10')
  })
})

describe('CouponsService.list', () => {
  it('scopes to org and applies filters', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findMany.mockResolvedValue([{ id: 'c1' }])
    await service.list('org-1', { storeId: 's1', status: 'active', search: 'SAVE' })
    const arg = prisma.coupon.findMany.mock.calls[0][0]
    expect(arg.where.store).toEqual({ organizationId: 'org-1' })
    expect(arg.where.storeId).toBe('s1')
    expect(arg.where.status).toBe('active')
    expect(arg.where.code).toEqual({ contains: 'SAVE', mode: 'insensitive' })
  })
})

describe('CouponsService.update', () => {
  it('clears affiliate and expiry when explicitly null', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue({ id: 'c1' })
    prisma.coupon.update.mockResolvedValue({ id: 'c1' })
    await service.update('org-1', 'c1', { affiliateId: null, expiresAt: null, status: 'disabled' })
    const data = prisma.coupon.update.mock.calls[0][0].data
    expect(data.affiliateId).toBeNull()
    expect(data.expiresAt).toBeNull()
    expect(data.status).toBe('disabled')
  })

  it('sets expiry as a Date when provided', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue({ id: 'c1' })
    prisma.coupon.update.mockResolvedValue({ id: 'c1' })
    await service.update('org-1', 'c1', { expiresAt: '2027-01-01T00:00:00.000Z' })
    expect(prisma.coupon.update.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date)
  })

  it('throws when coupon not found', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue(null)
    await expect(service.update('org-1', 'missing', { status: 'disabled' })).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('CouponsService.assign', () => {
  it('updates affiliateId', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue({ id: 'c1' })
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a2' })
    prisma.coupon.update.mockResolvedValue({ id: 'c1', affiliateId: 'a2' })
    const res = await service.assign('org-1', 'c1', 'a2')
    expect(res.affiliateId).toBe('a2')
  })

  it('throws when coupon not found', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue(null)
    await expect(service.assign('org-1', 'missing', 'a1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('CouponsService.bulkGenerate', () => {
  it('generates the requested number of unique codes', async () => {
    const { service, prisma } = makeService()
    prisma.store.findFirst.mockResolvedValue({ id: 's1' })
    prisma.coupon.findFirst.mockResolvedValue(null) // every candidate is unique
    let n = 0
    prisma.coupon.create.mockImplementation(({ data }: any) => ({ id: `c${++n}`, code: data.code }))
    const res = await service.bulkGenerate('org-1', { storeId: 's1', count: 5, prefix: 'AFF-' } as any)
    expect(res.created).toBe(5)
    expect(res.coupons).toHaveLength(5)
    expect(res.coupons[0].code.startsWith('AFF-')).toBe(true)
  })
})

describe('CouponsService.stats', () => {
  it('computes assigned/unassigned split', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7) // active
      .mockResolvedValueOnce(2) // disabled
      .mockResolvedValueOnce(1) // expired
      .mockResolvedValueOnce(4) // assigned
    const res = await service.stats('org-1')
    expect(res).toEqual({ total: 10, active: 7, disabled: 2, expired: 1, assigned: 4, unassigned: 6 })
  })
})

describe('CouponsService.findByCode', () => {
  it('only matches active, non-expired coupons', async () => {
    const { service, prisma } = makeService()
    prisma.coupon.findFirst.mockResolvedValue({ id: 'c1', affiliateId: 'a1' })
    const res = await service.findByCode('s1', 'SAVE10')
    expect(res?.affiliateId).toBe('a1')
    const where = prisma.coupon.findFirst.mock.calls[0][0].where
    expect(where.status).toBe('active')
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })
})
