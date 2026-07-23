import { ForbiddenException } from '@nestjs/common'
import { EntitlementsService } from './entitlements.service'

function makeService(sub: any) {
  const prisma: any = {
    subscription: { findUnique: jest.fn().mockResolvedValue(sub) },
    affiliate: { count: jest.fn().mockResolvedValue(0) },
    store: { count: jest.fn().mockResolvedValue(0) },
    user: { count: jest.fn().mockResolvedValue(0) },
    apiKey: { count: jest.fn().mockResolvedValue(0) },
  }
  return { service: new EntitlementsService(prisma), prisma }
}

const growthPlan = {
  key: 'growth',
  name: 'Growth',
  features: { apiAccess: true, customDomain: false },
  limits: { affiliates: 100, stores: 5 },
}

describe('EntitlementsService.getContext', () => {
  it('falls back to denied-by-default with no subscription', async () => {
    const { service } = makeService(null)
    const ctx = await service.getContext('org-1')
    expect(ctx.features.apiAccess).toBe(false)
    expect(ctx.features.customDomain).toBe(false)
    expect(ctx.limits.affiliates).toBe(5)
  })

  it('denies everything when subscription is canceled', async () => {
    const { service } = makeService({ status: 'canceled', plan: growthPlan })
    const ctx = await service.getContext('org-1')
    expect(ctx.features.apiAccess).toBe(false)
  })

  it('resolves plan features and limits when active', async () => {
    const { service } = makeService({ status: 'active', plan: growthPlan, overrides: null })
    const ctx = await service.getContext('org-1')
    expect(ctx.features.apiAccess).toBe(true)
    expect(ctx.limits.affiliates).toBe(100)
  })

  it('applies per-tenant overrides on top of the plan', async () => {
    const { service } = makeService({
      status: 'active',
      plan: growthPlan,
      overrides: { features: { customDomain: true }, limits: { affiliates: 250 } },
    })
    const ctx = await service.getContext('org-1')
    expect(ctx.features.customDomain).toBe(true)
    expect(ctx.limits.affiliates).toBe(250)
  })
})

describe('EntitlementsService.assertFeature', () => {
  it('throws when the feature is disabled', async () => {
    const { service } = makeService({ status: 'active', plan: growthPlan })
    await expect(service.assertFeature('org-1', 'customDomain')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('passes when the feature is enabled', async () => {
    const { service } = makeService({ status: 'active', plan: growthPlan })
    await expect(service.assertFeature('org-1', 'apiAccess')).resolves.toBeUndefined()
  })
})

describe('EntitlementsService.assertWithinLimit', () => {
  it('allows unlimited (-1) without counting', async () => {
    const { service, prisma } = makeService({ status: 'active', plan: { ...growthPlan, limits: { affiliates: -1 } } })
    await expect(service.assertWithinLimit('org-1', 'affiliates')).resolves.toBeUndefined()
    expect(prisma.affiliate.count).not.toHaveBeenCalled()
  })

  it('throws when adding one would exceed the cap', async () => {
    const { service, prisma } = makeService({ status: 'active', plan: { ...growthPlan, limits: { affiliates: 2 } } })
    prisma.affiliate.count.mockResolvedValue(2)
    await expect(service.assertWithinLimit('org-1', 'affiliates')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('allows when under the cap', async () => {
    const { service, prisma } = makeService({ status: 'active', plan: { ...growthPlan, limits: { affiliates: 5 } } })
    prisma.affiliate.count.mockResolvedValue(2)
    await expect(service.assertWithinLimit('org-1', 'affiliates')).resolves.toBeUndefined()
  })
})
