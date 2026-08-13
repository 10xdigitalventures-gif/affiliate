import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ApplicationsService } from './applications.service'

function makeService() {
  const prisma: any = {
    organization: { findUnique: jest.fn() },
    affiliateApplication: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    affiliate: { create: jest.fn() },
  }
  const mail: any = {
    send: jest.fn(async () => undefined),
    appUrl: 'http://localhost:3000',
  }
  const notifications: any = { notifyUser: jest.fn(async () => null), notifyOrgAdmins: jest.fn(async () => 0) }
  const service = new ApplicationsService(prisma, mail, notifications)
  return { service, prisma, mail }
}

describe('ApplicationsService.apply', () => {
  const dto = {
    email: 'new@aff.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    website: 'https://ada.dev',
  }

  it('throws when org slug unknown', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue(null)
    await expect(service.apply('missing', dto as any)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects when signup closed', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Demo',
      settings: { signupEnabled: false },
    })
    await expect(service.apply('demo', dto as any)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects duplicate pending application', async () => {
    const { service, prisma } = makeService()
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Demo', settings: {} })
    prisma.affiliateApplication.findFirst.mockResolvedValue({ id: 'app-1' })
    await expect(service.apply('demo', dto as any)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates pending application and emails applicant', async () => {
    const { service, prisma, mail } = makeService()
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Demo', settings: {} })
    prisma.affiliateApplication.findFirst.mockResolvedValue(null)
    prisma.affiliateApplication.create.mockResolvedValue({
      id: 'app-1',
      email: dto.email,
      payload: { firstName: 'Ada', lastName: 'Lovelace' },
      status: 'pending',
    })

    const res = await service.apply('demo', dto as any)
    expect(res).toEqual({ autoApproved: false, application: { id: 'app-1', status: 'pending' } })
    expect(mail.send).toHaveBeenCalled()
  })

  it('auto-approves when org setting enabled', async () => {
    const { service, prisma, mail } = makeService()
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Demo',
      settings: { autoApprove: true },
    })
    prisma.affiliateApplication.findFirst.mockResolvedValue(null)
    prisma.affiliateApplication.create.mockResolvedValue({
      id: 'app-2',
      email: dto.email,
      payload: { firstName: 'Ada' },
      status: 'pending',
    })
    prisma.affiliate.create.mockResolvedValue({
      id: 'aff-1',
      affiliateCode: 'ABC123',
      referralSlug: 'abc123',
      status: 'approved',
    })
    prisma.affiliateApplication.update.mockResolvedValue({ status: 'approved' })

    const res = await service.apply('demo', dto as any)
    expect(res.autoApproved).toBe(true)
    expect((res as any).affiliate.affiliateCode).toBe('ABC123')
    expect(mail.send).toHaveBeenCalled()
  })
})

describe('ApplicationsService.approve / reject', () => {
  it('approve creates affiliate and marks approved', async () => {
    const { service, prisma, mail } = makeService()
    prisma.affiliateApplication.findFirst.mockResolvedValue({
      id: 'app-1',
      organizationId: 'org-1',
      email: 'a@b.com',
      status: 'pending',
      payload: { firstName: 'Ada' },
    })
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Demo' })
    prisma.affiliate.create.mockResolvedValue({ id: 'aff-1', affiliateCode: 'ZZ9' })
    prisma.affiliateApplication.update.mockResolvedValue({ status: 'approved' })

    const res = await service.approve('org-1', 'app-1')
    expect(res.affiliate.affiliateCode).toBe('ZZ9')
    expect(mail.send).toHaveBeenCalled()
  })

  it('cannot approve non-pending application', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateApplication.findFirst.mockResolvedValue({
      id: 'app-1',
      status: 'rejected',
      email: 'a@b.com',
      payload: {},
    })
    await expect(service.approve('org-1', 'app-1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('reject marks rejected and emails', async () => {
    const { service, prisma, mail } = makeService()
    prisma.affiliateApplication.findFirst.mockResolvedValue({
      id: 'app-1',
      status: 'pending',
      email: 'a@b.com',
      payload: { firstName: 'Ada' },
    })
    prisma.organization.findUnique.mockResolvedValue({ name: 'Demo' })
    prisma.affiliateApplication.update.mockResolvedValue({ id: 'app-1', status: 'rejected' })

    const res = await service.reject('org-1', 'app-1')
    expect(res.status).toBe('rejected')
    expect(mail.send).toHaveBeenCalled()
  })

  it('throws NotFound when application missing', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateApplication.findFirst.mockResolvedValue(null)
    await expect(service.approve('org-1', 'nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})
