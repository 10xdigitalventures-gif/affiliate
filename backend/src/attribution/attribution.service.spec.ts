import { AttributionService } from './attribution.service'

/**
 * Prisma + coupons stubbed. Asserts coupon priority, last/first click,
 * multi-touch linear/position weights, lifetime, and settings.
 */
function makeService(orgSettings: Record<string, unknown> = {}) {
  const prisma: any = {
    organization: {
      findUnique: jest.fn(async () => ({
        id: 'org-1',
        settings: {
          cookieModel: 'last_click',
          cookieWindowDays: 60,
          couponPriority: true,
          lifetimeEnabled: true,
          ...orgSettings,
        },
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'org-1', settings: data.settings })),
    },
    affiliate: { findFirst: jest.fn() },
    click: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    customer: { findFirst: jest.fn() },
  }
  const coupons: any = { findByCode: jest.fn() }
  const service = new AttributionService(prisma, coupons)
  return { service, prisma, coupons }
}

describe('AttributionService', () => {
  it('returns null when nothing matches', async () => {
    const { service } = makeService()
    const result = await service.resolve('org-1', { storeId: 's-1' })
    expect(result).toBeNull()
  })

  describe('coupon', () => {
    it('attributes to coupon affiliate with full share', async () => {
      const { service, coupons } = makeService()
      coupons.findByCode.mockResolvedValue({ id: 'coup-1', affiliateId: 'aff-coupon' })
      const result = await service.resolve('org-1', { storeId: 's-1', couponCode: 'SAVE10' })
      expect(result).toMatchObject({
        affiliateId: 'aff-coupon',
        couponId: 'coup-1',
        method: 'coupon',
        model: 'coupon',
      })
      expect(result!.shares).toEqual([{ affiliateId: 'aff-coupon', weight: 1, role: 'coupon' }])
    })

    it('coupon wins over cookie when couponPriority=true', async () => {
      const { service, coupons, prisma } = makeService()
      coupons.findByCode.mockResolvedValue({ id: 'coup-1', affiliateId: 'aff-coupon' })
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-cookie' })
      const result = await service.resolve('org-1', {
        storeId: 's-1',
        couponCode: 'SAVE10',
        referralCode: 'REF',
      })
      expect(result!.method).toBe('coupon')
      expect(result!.affiliateId).toBe('aff-coupon')
    })

    it('falls through when coupon has no affiliate', async () => {
      const { service, coupons } = makeService()
      coupons.findByCode.mockResolvedValue({ id: 'coup-1', affiliateId: null })
      const result = await service.resolve('org-1', { storeId: 's-1', couponCode: 'GENERIC' })
      expect(result).toBeNull()
    })
  })

  describe('last_click (default)', () => {
    it('attributes to approved affiliate with last click id', async () => {
      const { service, prisma } = makeService()
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-cookie' })
      prisma.click.findFirst.mockResolvedValue({
        id: 'click-99',
        affiliateId: 'aff-cookie',
        ipHash: null,
        occurredAt: new Date(),
      })
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'REFCODE' })
      expect(result!.method).toBe('cookie')
      expect(result!.model).toBe('last_click')
      expect(result!.affiliateId).toBe('aff-cookie')
      expect(result!.clickId).toBe('click-99')
      expect(result!.shares).toHaveLength(1)
      expect(result!.shares[0].weight).toBe(1)
    })

    it('still attributes with null clickId if no click in window', async () => {
      const { service, prisma } = makeService()
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-cookie' })
      prisma.click.findFirst.mockResolvedValue(null)
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'REFCODE' })
      expect(result).toMatchObject({
        affiliateId: 'aff-cookie',
        clickId: null,
        method: 'cookie',
        model: 'last_click',
      })
    })

    it('does not attribute to unknown/unapproved referral code', async () => {
      const { service, prisma } = makeService()
      prisma.affiliate.findFirst.mockResolvedValue(null)
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'NOPE' })
      expect(result).toBeNull()
    })
  })

  describe('first_click', () => {
    it('credits the first unique affiliate in the IP path', async () => {
      const { service, prisma } = makeService({ cookieModel: 'first_click' })
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-last' })
      prisma.click.findFirst.mockResolvedValue({
        id: 'c-last',
        affiliateId: 'aff-last',
        ipHash: 'ip-1',
        occurredAt: new Date(),
      })
      prisma.click.findMany.mockResolvedValue([
        { id: 'c1', affiliateId: 'aff-first', occurredAt: new Date('2026-01-01') },
        { id: 'c2', affiliateId: 'aff-mid', occurredAt: new Date('2026-01-02') },
        { id: 'c3', affiliateId: 'aff-last', occurredAt: new Date('2026-01-03') },
      ])
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'LAST' })
      expect(result!.model).toBe('first_click')
      expect(result!.affiliateId).toBe('aff-first')
      expect(result!.shares).toHaveLength(1)
      expect(result!.shares[0]).toMatchObject({ affiliateId: 'aff-first', weight: 1, role: 'first' })
    })
  })

  describe('multi-touch linear', () => {
    it('splits weight equally across path affiliates', async () => {
      const { service, prisma } = makeService({ cookieModel: 'linear' })
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-c' })
      prisma.click.findFirst.mockResolvedValue({
        id: 'c3',
        affiliateId: 'aff-c',
        ipHash: 'ip-x',
        occurredAt: new Date(),
      })
      prisma.click.findMany.mockResolvedValue([
        { id: 'c1', affiliateId: 'aff-a', occurredAt: new Date('2026-01-01') },
        { id: 'c2', affiliateId: 'aff-b', occurredAt: new Date('2026-01-02') },
        { id: 'c3', affiliateId: 'aff-c', occurredAt: new Date('2026-01-03') },
      ])
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'C' })
      expect(result!.model).toBe('linear')
      expect(result!.shares).toHaveLength(3)
      expect(result!.shares.every((s) => Math.abs(s.weight - 1 / 3) < 1e-9)).toBe(true)
      const sum = result!.shares.reduce((a, s) => a + s.weight, 0)
      expect(sum).toBeCloseTo(1, 9)
    })
  })

  describe('multi-touch position', () => {
    it('uses 40/20/40 for 3+ touches', async () => {
      const { service, prisma } = makeService({ cookieModel: 'position' })
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-c' })
      prisma.click.findFirst.mockResolvedValue({
        id: 'c3',
        affiliateId: 'aff-c',
        ipHash: 'ip-x',
        occurredAt: new Date(),
      })
      prisma.click.findMany.mockResolvedValue([
        { id: 'c1', affiliateId: 'aff-a', occurredAt: new Date('2026-01-01') },
        { id: 'c2', affiliateId: 'aff-b', occurredAt: new Date('2026-01-02') },
        { id: 'c3', affiliateId: 'aff-c', occurredAt: new Date('2026-01-03') },
      ])
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'C' })
      expect(result!.model).toBe('position')
      const byId = Object.fromEntries(result!.shares.map((s) => [s.affiliateId, s.weight]))
      expect(byId['aff-a']).toBeCloseTo(0.4)
      expect(byId['aff-b']).toBeCloseTo(0.2)
      expect(byId['aff-c']).toBeCloseTo(0.4)
    })

    it('uses 50/50 for two touches', async () => {
      const { service, prisma } = makeService({ cookieModel: 'position' })
      prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-b' })
      prisma.click.findFirst.mockResolvedValue({
        id: 'c2',
        affiliateId: 'aff-b',
        ipHash: 'ip-y',
        occurredAt: new Date(),
      })
      prisma.click.findMany.mockResolvedValue([
        { id: 'c1', affiliateId: 'aff-a', occurredAt: new Date('2026-01-01') },
        { id: 'c2', affiliateId: 'aff-b', occurredAt: new Date('2026-01-02') },
      ])
      const result = await service.resolve('org-1', { storeId: 's-1', referralCode: 'B' })
      expect(result!.shares.map((s) => s.weight)).toEqual([0.5, 0.5])
    })
  })

  describe('lifetime', () => {
    it('attributes to customer first affiliate', async () => {
      const { service, prisma } = makeService()
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', firstAffiliateId: 'aff-first' })
      const result = await service.resolve('org-1', { storeId: 's-1', customerId: 'cust-1' })
      expect(result).toMatchObject({
        affiliateId: 'aff-first',
        method: 'lifetime',
        model: 'lifetime',
      })
    })

    it('skips lifetime when disabled', async () => {
      const { service, prisma } = makeService({ lifetimeEnabled: false })
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', firstAffiliateId: 'aff-first' })
      const result = await service.resolve('org-1', { storeId: 's-1', customerId: 'cust-1' })
      expect(result).toBeNull()
    })
  })

  describe('settings', () => {
    it('reads defaults and updates cookie model', async () => {
      const { service, prisma } = makeService()
      const before = await service.getSettings('org-1')
      expect(before.cookieModel).toBe('last_click')
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settings: { cookieModel: 'linear', cookieWindowDays: 30, couponPriority: true, lifetimeEnabled: true },
      })
      // updateSettings merges then re-reads via getSettings
      prisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1', settings: { cookieModel: 'last_click' } }) // for update load
        .mockResolvedValueOnce({ id: 'org-1', settings: { cookieModel: 'last_click' } }) // getSettings inside update
        .mockResolvedValueOnce({
          id: 'org-1',
          settings: { cookieModel: 'linear', cookieWindowDays: 60, couponPriority: true, lifetimeEnabled: true },
        }) // final get not used — update returns next directly
      const next = await service.updateSettings('org-1', { cookieModel: 'linear' })
      expect(next.cookieModel).toBe('linear')
      expect(prisma.organization.update).toHaveBeenCalled()
    })
  })
})
