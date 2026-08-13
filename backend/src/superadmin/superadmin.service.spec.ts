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
    organization: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    subscription: { upsert: jest.fn(), findMany: jest.fn() },
    user: { count: jest.fn() },
    affiliate: { count: jest.fn() },
  }
  return { service: new SuperAdminService(prisma), prisma }
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
