import { BillingService } from './billing.service'
import { BadRequestException } from '@nestjs/common'

function makeService() {
  const prisma: any = {
    subscription: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  const crypto: any = { encrypt: jest.fn(), decrypt: jest.fn() }
  const factory: any = { build: jest.fn() }
  const service = new BillingService(prisma, crypto, factory)
  return { service, prisma }
}

describe('BillingService billing-cycle concurrency', () => {
  const due = {
    id: 'sub_1',
    organizationId: 'org_1',
    status: 'active',
    currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    plan: { name: 'Growth', interval: 'month', priceCents: 4900, currency: 'USD' },
  }

  it('skips a subscription already claimed by another worker', async () => {
    const { service, prisma } = makeService()
    prisma.subscription.findMany.mockResolvedValue([due])
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
    const charge = jest.spyOn(service, 'chargeTenant')

    const result = await service.runBillingCycle(new Date('2026-07-02T00:00:00.000Z'))

    expect(charge).not.toHaveBeenCalled()
    expect(result.results[0]).toMatchObject({ ok: true, skipped: true })
  })

  it('uses a deterministic period key and advances only a paid cycle', async () => {
    const { service, prisma } = makeService()
    prisma.subscription.findMany.mockResolvedValue([due])
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
    const charge = jest.spyOn(service, 'chargeTenant').mockResolvedValue({ status: 'paid' } as any)

    const result = await service.runBillingCycle(new Date('2026-07-02T00:00:00.000Z'))

    expect(result.results[0]).toMatchObject({ ok: true })
    expect(charge).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ amountCents: 4900 }),
      expect.objectContaining({
        idempotencyKey: 'subscription:sub_1:2026-07-01T00:00:00.000Z',
        periodStart: due.currentPeriodEnd,
      }),
    )
    const settlement = prisma.subscription.updateMany.mock.calls[1][0]
    expect(settlement.data.status).toBe('active')
    expect(settlement.data.currentPeriodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(settlement.data.billingLockToken).toBeNull()
  })

  it('clips month-end renewals without timezone or overflow drift', async () => {
    const { service, prisma } = makeService()
    prisma.subscription.findMany.mockResolvedValue([{
      ...due,
      currentPeriodEnd: new Date('2026-01-31T23:30:00.000Z'),
      plan: { ...due.plan, priceCents: 0 },
    }])
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 })

    await service.runBillingCycle(new Date('2026-02-01T00:00:00.000Z'))

    const settlement = prisma.subscription.updateMany.mock.calls[1][0]
    expect(settlement.data.currentPeriodEnd.toISOString()).toBe('2026-02-28T23:30:00.000Z')
  })
})

describe('BillingService redirect and payout input safety', () => {
  const previousAppUrl = process.env.APP_URL

  afterEach(() => {
    if (previousAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = previousAppUrl
  })

  it('allows return paths only on the configured application origin', () => {
    const { service } = makeService()
    process.env.APP_URL = 'https://affiliate.mentoringhub.online'

    expect((service as any).validatedReturnUrl('https://affiliate.mentoringhub.online/billing/done'))
      .toBe('https://affiliate.mentoringhub.online/billing/done')
    expect(() => (service as any).validatedReturnUrl('https://attacker.example/collect'))
      .toThrow(BadRequestException)
  })

  it('rejects oversized gateway payout destinations', () => {
    const { service } = makeService()
    expect(() => (service as any).assertPayoutDestination({ account: 'x'.repeat(9_000) }))
      .toThrow(BadRequestException)
  })
})

describe('BillingService public webhook URL', () => {
  const previousPublicUrl = process.env.APP_PUBLIC_URL

  afterEach(() => {
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL
    else process.env.APP_PUBLIC_URL = previousPublicUrl
  })

  it('uses the live HTTPS platform URL when no public origin is configured', () => {
    const { service } = makeService()
    delete process.env.APP_PUBLIC_URL
    expect(service.webhookUrl('cfg-1', 'whop'))
      .toBe('https://affiliate.mentoringhub.online/v1/billing/webhooks/whop/cfg-1')
  })
})
