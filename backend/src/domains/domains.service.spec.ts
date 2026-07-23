import { BadRequestException, NotFoundException } from '@nestjs/common'
import { DomainsService } from './domains.service'

jest.mock('dns', () => ({ promises: { resolveTxt: jest.fn() } }))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promises: mockDns } = require('dns')

function makeService() {
  const prisma: any = {
    domain: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  return { service: new DomainsService(prisma), prisma }
}

describe('DomainsService.add', () => {
  it('rejects an already-registered domain', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findUnique.mockResolvedValue({ id: 'd1' })
    await expect(service.add('org-1', { hostname: 'go.brand.com' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates with a verification token and instructions', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findUnique.mockResolvedValue(null)
    prisma.domain.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'd2', ...data }))
    const res = await service.add('org-1', { hostname: 'Go.Brand.com' })
    expect(res.hostname).toBe('go.brand.com')
    expect(res.verificationToken).toMatch(/^aff-verify-/)
    expect(res.instructions.cname.host).toBe('go.brand.com')
  })
})

describe('DomainsService.verify', () => {
  it('activates when the TXT token matches', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1', hostname: 'go.brand.com', verificationToken: 'tok-123' })
    prisma.domain.update.mockResolvedValue({ id: 'd1', status: 'active' })
    mockDns.resolveTxt.mockResolvedValue([['tok-123']])
    const res = await service.verify('org-1', 'd1')
    expect(res.status).toBe('active')
  })

  it('fails when the token is missing', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1', hostname: 'go.brand.com', verificationToken: 'tok-123' })
    prisma.domain.update.mockResolvedValue({})
    mockDns.resolveTxt.mockResolvedValue([['other']])
    await expect(service.verify('org-1', 'd1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws NotFound for an unknown domain', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue(null)
    await expect(service.verify('org-1', 'nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})
