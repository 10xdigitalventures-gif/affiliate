import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { TeamService } from './team.service'

function makeService() {
  const prisma: any = {
    user: { findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    role: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
    permission: { findMany: jest.fn() },
    userRole: { count: jest.fn() },
    invitation: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  }
  const audit: any = { log: jest.fn() }
  const entitlements: any = { assertWithinLimit: jest.fn() }
  return { service: new TeamService(prisma, audit, entitlements), prisma, audit, entitlements }
}

describe('TeamService tenant and privilege boundaries', () => {
  it('lists only users from the requested organization and excludes affiliate-only accounts', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValue([])

    await service.listMembers('org-a')

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: 'org-a',
        OR: [{ affiliate: null }, { roles: { some: {} } }],
      },
    }))
  })

  it('does not allow an administrator to remove their own access', async () => {
    const { service, prisma } = makeService()
    await expect(service.updateMember('org-a', 'user-a', 'user-a', { status: 'suspended' }))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('does not permit tenant administrators to mutate a system role', async () => {
    const { service, prisma } = makeService()
    prisma.role.findFirst.mockResolvedValue({
      id: 'role-a', organizationId: 'org-a', name: 'Admin', isSystem: true, permissions: [],
    })
    await expect(service.updateRole('org-a', 'user-a', 'role-a', { name: 'Other' }))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects unknown permission keys instead of silently creating an over-broad role', async () => {
    const { service, prisma } = makeService()
    prisma.role.findFirst.mockResolvedValue(null)
    prisma.permission.findMany.mockResolvedValue([])
    await expect(service.createRole('org-a', 'user-a', {
      name: 'Analyst', permissionKeys: ['reports.superuser'],
    })).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.role.create).not.toHaveBeenCalled()
  })

  it('cannot revoke an invitation that belongs to another tenant', async () => {
    const { service, prisma } = makeService()
    prisma.invitation.findFirst.mockResolvedValue(null)
    await expect(service.revokeInvitation('org-a', 'user-a', 'invite-b'))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.invitation.findFirst).toHaveBeenCalledWith({
      where: { id: 'invite-b', organizationId: 'org-a', acceptedAt: null },
    })
  })
})
