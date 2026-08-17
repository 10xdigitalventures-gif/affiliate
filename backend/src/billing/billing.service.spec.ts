import { BillingService } from './billing.service'
import { BadRequestException } from '@nestjs/common'

function makeService() {
  const prisma: any = { subscription: {
    findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn().mockResolvedValue({}),
  } }
  const service = new BillingService(prisma, { encrypt: jest.fn(), decrypt: jest.fn() } as any, { build: jest.fn() } as any)
  return { service, prisma }
}

const due = { id: 'sub_1', organizationId: 'org_1', status: 'active', currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'), plan: { name: 'Growth', interval: 'month', priceCents: 4900, currency: 'USD' } }

describe('BillingService billing-cycle concurrency', () => {
  it('skips a subscription already claimed by another worker', async () => {
    const { service, prisma } = makeService(); prisma.subscription.findMany.mockResolvedValue([due]); prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
    const charge = jest.spyOn(service, 'chargeTenant')
    const result = await service.runBillingCycle(new Date('2026-07-02T00:00:00.000Z'))
    expect(charge).not.toHaveBeenCalled(); expect(result.results[0]).toMatchObject({ ok: true, skipped: true })
  })

  it('uses a deterministic key and advances a paid cycle', async () => {
    const { service, prisma } = makeService(); prisma.subscription.findMany.mockResolvedValue([due]); prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
    jest.spyOn(service, 'chargeTenant').mockResolvedValue({ status: 'paid' } as any)
    const result = await service.runBillingCycle(new Date('2026-07-02T00:00:00.000Z'))
    expect(result.results[0]).toMatchObject({ ok: true })
    expect(prisma.subscription.updateMany.mock.calls[1][0].data.currentPeriodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('clips month-end renewals', async () => {
    const { service, prisma } = makeService()
    prisma.subscription.findMany.mockResolvedValue([{ ...due, currentPeriodEnd: new Date('2026-01-31T23:30:00.000Z'), plan: { ...due.plan, priceCents: 0 } }])
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
    await service.runBillingCycle(new Date('2026-02-01T00:00:00.000Z'))
    expect(prisma.subscription.updateMany.mock.calls[1][0].data.currentPeriodEnd.toISOString()).toBe('2026-02-28T23:30:00.000Z')
  })
})

describe('BillingService input safety', () => {
  it('allows only the configured return origin', () => {
    const { service } = makeService(); process.env.APP_URL = 'https://affiliate.mentoringhub.online'
    expect((service as any).validatedReturnUrl('https://affiliate.mentoringhub.online/billing/done')).toContain('/billing/done')
    expect(() => (service as any).validatedReturnUrl('https://attacker.example/collect')).toThrow(BadRequestException)
  })

  it('rejects oversized payout destinations', () => {
    const { service } = makeService()
    expect(() => (service as any).assertPayoutDestination({ account: 'x'.repeat(9_000) })).toThrow(BadRequestException)
  })
})
