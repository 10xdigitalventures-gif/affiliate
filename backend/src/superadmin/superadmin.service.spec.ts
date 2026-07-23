import { BadRequestException, NotFoundException } from '@nestjs/common'
import { SuperAdminService } from './superadmin.service'

function makeService() {
  const prisma: any = {
    plan: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organization: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    subscription: { upsert: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    affiliate: { count: jest.fn() },
    permission: { createMany: jest.fn(), findMany: jest.fn() },
    role: { create: jest.fn() },
    rolePermission: { createMany: jest.fn() },
    userRole: { create: jest.fn() },
    commissionRule: { create: jest.fn() },
  }
  prisma.$transaction = jest.fn(async (work: any) => work(prisma))
  const entitlements: any = {
    getContext: jest.fn().mockResolvedValue({ features: {}, limits: {} }),
    usage: jest.fn().mockResolvedValue({ affiliates: 0, stores: 0, teamMembers: 0, apiKeys: 0 }),
  }
  return { service: new SuperAdminService(prisma, entitlements), prisma, entitlements }
}

describe('SuperAdminService.createPlan', () => {
  it('rejects a duplicate key', async () => {
    const { service, prisma } = makeService()
    prisma.plan.findUnique.mockResolvedValue({ id: 'p1' })
    await expect(
      service.createPlan({ key: 'growth', name: 'Growth', priceCents: 100, features: {}, limits: {} } as any),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates when key is free', async () => {
    const { service, prisma } = makeService()
    prisma.plan.findUnique.mockResolvedValue(null)
    prisma.plan.create.mockResolvedValue({ id: 'p2', key: 'growth' })
    const res = await service.createPlan({ key: 'growth', name: 'Growth', priceCents: 100, features: {}, limits: {} } as any)
    expect(res.id).toBe('p2')
  })
})

describe('SuperAdminService.createTenant', () => {
  it('creates a plan-backed organization with a passwordless invited owner', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue(null)
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.plan.findUnique.mockResolvedValue({
      id: 'plan-1', key: 'growth', name: 'Growth', interval: 'month', trialDays: 14, isArchived: false,
    })
    prisma.organization.create.mockResolvedValue({
      id: 'org-1', name: 'Acme', slug: 'acme', status: 'trial', createdAt: new Date(),
    })
    prisma.permission.createMany.mockResolvedValue({ count: 15 })
    prisma.permission.findMany.mockResolvedValue(Array.from({ length: 15 }, (_, index) => ({ id: `perm-${index + 1}` })))
    prisma.role.create.mockResolvedValue({ id: 'role-1' })
    prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'user-1', ...data }))
    prisma.subscription.create.mockResolvedValue({ status: 'trialing', currentPeriodEnd: new Date() })

    const result = await service.createTenant({
      name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com', planId: 'plan-1', status: 'trial',
    } as any)

    expect(result.plan).toMatchObject({ id: 'plan-1', key: 'growth' })
    expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      email: 'owner@example.com', status: 'invited', emailVerifiedAt: null,
    }) })
    expect(prisma.subscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ planId: 'plan-1', status: 'trialing', trialEndsAt: expect.any(Date) }),
    }))
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 30_000 })
  })

  it('maps a database uniqueness race to a useful conflict response', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue(null)
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.permission.createMany.mockResolvedValue({ count: 15 })
    prisma.permission.findMany.mockResolvedValue(Array.from({ length: 15 }, (_, index) => ({ id: `perm-${index + 1}` })))
    prisma.$transaction.mockRejectedValue({ code: 'P2002' })

    await expect(service.createTenant({
      name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com', status: 'trial',
    } as any)).rejects.toMatchObject({ status: 409 })
  })
})

describe('SuperAdminService.deletePlan', () => {
  it('archives instead of deleting when subscribers exist', async () => {
    const { service, prisma } = makeService()
    prisma.plan.findUnique.mockResolvedValue({ id: 'p1', _count: { subscriptions: 3 } })
    prisma.plan.update.mockResolvedValue({ id: 'p1', isArchived: true })
    const res = await service.deletePlan('p1')
    expect(res.archived).toBe(true)
    expect(prisma.plan.delete).not.toHaveBeenCalled()
  })

  it('hard-deletes when unused', async () => {
    const { service, prisma } = makeService()
    prisma.plan.findUnique.mockResolvedValue({ id: 'p1', _count: { subscriptions: 0 } })
    prisma.plan.delete.mockResolvedValue({})
    const res = await service.deletePlan('p1')
    expect(res.deleted).toBe(true)
  })
})

describe('SuperAdminService.assignPlan', () => {
  it('throws when the plan is missing', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', _count: {} })
    prisma.plan.findUnique.mockResolvedValue(null)
    await expect(service.assignPlan('org-1', { planId: 'nope' } as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('upserts the subscription and syncs the org plan label', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', _count: {} })
    prisma.plan.findUnique.mockResolvedValue({ id: 'p1', key: 'growth' })
    prisma.subscription.upsert.mockResolvedValue({ id: 's1', plan: { key: 'growth' } })
    prisma.organization.update.mockResolvedValue({})
    const res = await service.assignPlan('org-1', { planId: 'p1', status: 'active' } as any)
    expect(res.id).toBe('s1')
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { plan: 'growth' } })
  })
})
