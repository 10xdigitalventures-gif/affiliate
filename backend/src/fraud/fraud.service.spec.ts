import { FraudService } from './fraud.service'

/**
 * Prisma + audit + commissions are stubbed. We assert scoring, thresholds,
 * allowlist, and decision mapping (allow / review / block).
 */
function makeService(settingsOverride: Record<string, unknown> = {}) {
  const orgSettings = {
    fraud: {
      reviewThreshold: 40,
      blockThreshold: 80,
      orderVelocityLimit: 5,
      orderVelocityWindowHours: 24,
      ipVelocityLimit: 15,
      ipVelocityWindowMinutes: 60,
      allowlistAffiliateIds: [] as string[],
      ...settingsOverride,
    },
  }

  const prisma: any = {
    organization: {
      findUnique: jest.fn(async () => ({ id: 'org-1', settings: orgSettings })),
      update: jest.fn(async ({ data }: any) => ({ id: 'org-1', settings: data.settings })),
    },
    affiliate: {
      findUnique: jest.fn(async () => ({ userId: null, createdAt: new Date(Date.now() - 30 * 864e5), status: 'approved' })),
    },
    customer: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    order: { count: jest.fn(async () => 0) },
    click: { count: jest.fn(async () => 0) },
    fraudReview: {
      count: jest.fn(async () => 0),
      upsert: jest.fn(async ({ create }: any) => ({ id: 'fr-1', ...create })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(),
      update: jest.fn(async ({ data }: any) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'fr-1', status: 'approved' })),
    },
  }
  const audit: any = { log: jest.fn(async () => ({})) }
  const commissions: any = { generateForOrder: jest.fn(async () => ({ id: 'c-1' })) }
  const service = new FraudService(prisma, audit, commissions)
  return { service, prisma, audit, commissions }
}

describe('FraudService scoring', () => {
  it('allows a clean order with score 0', async () => {
    const { service } = makeService()
    const r = await service.checkOrder({
      organizationId: 'org-1',
      affiliateId: 'aff-1',
      customerId: 'cust-1',
      ipHash: 'ip-1',
    })
    expect(r).toMatchObject({ blocked: false, decision: 'allow', score: 0, reasons: [] })
  })

  it('blocks self-referral (score 100)', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findUnique.mockResolvedValue({ userId: 'user-1', createdAt: new Date(), status: 'approved' })
    prisma.customer.findUnique.mockResolvedValue({ email: 'a@b.com' })
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    const r = await service.checkOrder({ organizationId: 'org-1', affiliateId: 'aff-1', customerId: 'cust-1' })
    expect(r.decision).toBe('block')
    expect(r.blocked).toBe(true)
    expect(r.reasons).toContain('self_referral')
    expect(r.score).toBeGreaterThanOrEqual(80)
  })

  it('flags order velocity as review when only that signal fires', async () => {
    const { service, prisma } = makeService()
    prisma.order.count.mockResolvedValue(5)
    const r = await service.checkOrder({ organizationId: 'org-1', affiliateId: 'aff-1', customerId: 'cust-1' })
    // weight 50 → between review(40) and block(80)
    expect(r.decision).toBe('review')
    expect(r.blocked).toBe(false)
    expect(r.reasons).toContain('order_velocity')
    expect(r.score).toBe(50)
  })

  it('allows at 4 orders (under velocity limit)', async () => {
    const { service, prisma } = makeService()
    prisma.order.count.mockResolvedValue(4)
    const r = await service.checkOrder({ organizationId: 'org-1', affiliateId: 'aff-1', customerId: 'cust-1' })
    expect(r.decision).toBe('allow')
    expect(r.score).toBe(0)
  })

  it('scores IP velocity and maps to review', async () => {
    const { service, prisma } = makeService()
    prisma.click.count.mockResolvedValue(15)
    const r = await service.checkOrder({ organizationId: 'org-1', affiliateId: 'aff-1', ipHash: 'ip-1' })
    expect(r.decision).toBe('review')
    expect(r.reasons).toContain('ip_velocity')
    expect(r.score).toBe(40)
  })

  it('stacks signals and can reach block', async () => {
    const { service, prisma } = makeService()
    prisma.order.count.mockResolvedValue(5) // 50
    prisma.click.count.mockResolvedValue(20) // 40 → 90
    const r = await service.checkOrder({
      organizationId: 'org-1',
      affiliateId: 'aff-1',
      customerId: 'cust-1',
      ipHash: 'ip-1',
    })
    expect(r.decision).toBe('block')
    expect(r.score).toBe(90)
    expect(r.reasons).toEqual(expect.arrayContaining(['order_velocity', 'ip_velocity']))
  })

  it('skips checks for allowlisted affiliates', async () => {
    const { service, prisma } = makeService({ allowlistAffiliateIds: ['aff-vip'] })
    prisma.order.count.mockResolvedValue(99)
    const r = await service.checkOrder({
      organizationId: 'org-1',
      affiliateId: 'aff-vip',
      customerId: 'cust-1',
    })
    expect(r).toMatchObject({ decision: 'allow', score: 0, blocked: false })
    expect(prisma.order.count).not.toHaveBeenCalled()
  })

  it('adds high_value signal for large orders', async () => {
    const { service } = makeService()
    const r = await service.checkOrder({
      organizationId: 'org-1',
      affiliateId: 'aff-1',
      orderTotal: 1500,
    })
    // weight 15 < review 40 → still allow, but signal present
    expect(r.decision).toBe('allow')
    expect(r.reasons).toContain('high_value')
    expect(r.score).toBe(15)
  })

  it('createReview persists open queue row', async () => {
    const { service, prisma } = makeService()
    const result = await service.checkOrder({
      organizationId: 'org-1',
      affiliateId: 'aff-1',
      customerId: 'cust-1',
    })
    // force a review-shaped result
    const reviewResult = { ...result, decision: 'review' as const, score: 50, reasons: ['order_velocity'], signals: [] }
    await service.createReview({
      organizationId: 'org-1',
      orderId: 'ord-1',
      affiliateId: 'aff-1',
      result: reviewResult,
    })
    expect(prisma.fraudReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'open', decision: 'review', score: 50 }),
      }),
    )
  })
})
