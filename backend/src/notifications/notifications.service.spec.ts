import { NotFoundException } from '@nestjs/common'
import { NotificationsService } from './notifications.service'

function makeService(settings: any = {}) {
  const prisma: any = {
    organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1', settings }) },
    user: { findMany: jest.fn() },
    notification: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  return { service: new NotificationsService(prisma), prisma }
}

describe('NotificationsService.notifyUser', () => {
  it('creates an in-app notification for the recipient', async () => {
    const { service, prisma } = makeService()
    prisma.notification.create.mockResolvedValue({ id: 'n1' })
    const res = await service.notifyUser('org-1', 'u1', { type: 'commission.approved', title: 'Approved' })
    expect(res).toEqual({ id: 'n1' })
    const data = prisma.notification.create.mock.calls[0][0].data
    expect(data.recipientUserId).toBe('u1')
    expect(data.channel).toBe('in_app')
    expect(data.title).toBe('Approved')
  })

  it('no-ops when recipient is null', async () => {
    const { service, prisma } = makeService()
    const res = await service.notifyUser('org-1', null, { type: 't', title: 'x' })
    expect(res).toBeNull()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('respects the inAppEnabled=false preference', async () => {
    const { service, prisma } = makeService({ notifications: { inAppEnabled: false } })
    const res = await service.notifyUser('org-1', 'u1', { type: 't', title: 'x' })
    expect(res).toBeNull()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.record', () => {
  it('swallows DB errors and returns null', async () => {
    const { service, prisma } = makeService()
    prisma.notification.create.mockRejectedValue(new Error('db down'))
    const res = await service.record({ organizationId: 'org-1', type: 't', title: 'x' })
    expect(res).toBeNull()
  })
})

describe('NotificationsService.notifyOrgAdmins', () => {
  it('creates one notification per admin with the permission', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    prisma.notification.createMany.mockResolvedValue({ count: 2 })
    const n = await service.notifyOrgAdmins('org-1', 'affiliates.write', { type: 'application.new', title: 'New application' })
    expect(n).toBe(2)
    const rows = prisma.notification.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows[0].recipientUserId).toBe('a1')
  })

  it('returns 0 when no admins match', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValue([])
    const n = await service.notifyOrgAdmins('org-1', 'affiliates.write', { type: 't', title: 'x' })
    expect(n).toBe(0)
    expect(prisma.notification.createMany).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.list', () => {
  it('filters to unread when requested and caps the limit', async () => {
    const { service, prisma } = makeService()
    prisma.notification.findMany.mockResolvedValue([])
    await service.list('org-1', 'u1', { unreadOnly: true, limit: 999 })
    const arg = prisma.notification.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ organizationId: 'org-1', recipientUserId: 'u1', readAt: null })
    expect(arg.take).toBe(200)
  })
})

describe('NotificationsService.markRead', () => {
  it('throws when the notification is not the user\u2019s', async () => {
    const { service, prisma } = makeService()
    prisma.notification.findFirst.mockResolvedValue(null)
    await expect(service.markRead('org-1', 'u1', 'n1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('sets readAt when unread', async () => {
    const { service, prisma } = makeService()
    prisma.notification.findFirst.mockResolvedValue({ id: 'n1', readAt: null })
    prisma.notification.update.mockResolvedValue({ id: 'n1', readAt: new Date() })
    const res = await service.markRead('org-1', 'u1', 'n1')
    expect(res.readAt).toBeInstanceOf(Date)
  })

  it('is idempotent when already read', async () => {
    const { service, prisma } = makeService()
    const already = { id: 'n1', readAt: new Date() }
    prisma.notification.findFirst.mockResolvedValue(already)
    const res = await service.markRead('org-1', 'u1', 'n1')
    expect(res).toBe(already)
    expect(prisma.notification.update).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.markAllRead', () => {
  it('returns the number updated', async () => {
    const { service, prisma } = makeService()
    prisma.notification.updateMany.mockResolvedValue({ count: 3 })
    const res = await service.markAllRead('org-1', 'u1')
    expect(res).toEqual({ updated: 3 })
  })
})
