import { Test } from '@nestjs/testing'
import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'crypto'
import { ApiKeysService } from './apikeys.service'
import { PrismaService } from '../prisma/prisma.service'
import { EntitlementsService } from '../entitlements/entitlements.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('ApiKeysService', () => {
  let service: ApiKeysService
  let prisma: any

  beforeEach(async () => {
    prisma = { apiKey: {
      create: jest.fn((args: any) => ({ id: 'k-1', name: args.data.name, scopes: args.data.scopes, createdAt: new Date() })),
      findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), update: jest.fn().mockResolvedValue({}),
    } }
    const entitlements = {
      assertFeature: jest.fn().mockResolvedValue(undefined),
      assertWithinLimit: jest.fn().mockResolvedValue(undefined),
    }
    const moduleRef = await Test.createTestingModule({ providers: [
      ApiKeysService,
      { provide: PrismaService, useValue: prisma },
      { provide: EntitlementsService, useValue: entitlements },
    ] }).compile()
    service = moduleRef.get(ApiKeysService)
  })

  it('stores only a hash and returns the raw key once', async () => {
    const result = await service.create('org-1', { name: 'Test', scopes: ['orders.write'] })
    expect(result.key).toMatch(/^aff_live_[0-9a-f]{48}$/)
    expect(prisma.apiKey.create.mock.calls[0][0].data.keyHash).toBe(sha256(result.key))
  })

  it('defaults scopes and generates unique keys', async () => {
    const first = await service.create('org-1', { name: 'A' })
    const second = await service.create('org-1', { name: 'B' })
    expect(prisma.apiKey.create.mock.calls[0][0].data.scopes).toEqual(['orders.write'])
    expect(first.key).not.toBe(second.key)
  })

  it('rejects malformed and unknown keys', async () => {
    await expect(service.verify('bad_key')).rejects.toBeInstanceOf(UnauthorizedException)
    prisma.apiKey.findFirst.mockResolvedValue(null)
    await expect(service.verify('aff_live_' + 'a'.repeat(48))).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('verifies a valid key and records use', async () => {
    const raw = 'aff_live_' + 'b'.repeat(48)
    prisma.apiKey.findFirst.mockResolvedValue({ id: 'k-1', organizationId: 'org-1', scopes: ['orders.write'] })
    await expect(service.verify(raw)).resolves.toMatchObject({ id: 'k-1' })
    expect(prisma.apiKey.update).toHaveBeenCalled()
  })

  it('only revokes an owned key', async () => {
    prisma.apiKey.findFirst.mockResolvedValue(null)
    await expect(service.revoke('org-1', 'other')).rejects.toBeInstanceOf(NotFoundException)
    prisma.apiKey.findFirst.mockResolvedValue({ id: 'k-1' })
    await expect(service.revoke('org-1', 'k-1')).resolves.toEqual({ revoked: true })
  })

  it('never returns keyHash in list results', async () => {
    prisma.apiKey.findMany.mockResolvedValue([])
    await service.list('org-1')
    expect(prisma.apiKey.findMany.mock.calls[0][0].select.keyHash).toBeUndefined()
  })
})
