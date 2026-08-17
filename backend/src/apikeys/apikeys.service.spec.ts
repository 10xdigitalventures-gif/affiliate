import { Test } from '@nestjs/testing'
import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'crypto'
import { ApiKeysService } from './apikeys.service'
import { PrismaService } from '../prisma/prisma.service'
import { EntitlementsService } from '../entitlements/entitlements.service'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

describe('ApiKeysService', () => {
  let service: ApiKeysService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(),
        delete: jest.fn(), update: jest.fn().mockResolvedValue({}),
      },
    }
    const entitlements = { assertWithinLimit: jest.fn().mockResolvedValue(undefined) }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: EntitlementsService, useValue: entitlements },
      ],
    }).compile()
    service = moduleRef.get(ApiKeysService)
  })

  describe('create', () => {
    it('returns a raw key with aff_live_ prefix and stores only the hash', async () => {
      prisma.apiKey.create.mockImplementation((args: any) => ({ id: 'k-1', name: args.data.name, scopes: args.data.scopes, createdAt: new Date() }))
      const result = await service.create('org-1', { name: 'Test', scopes: ['orders.write'] })
      expect(result.key).toMatch(/^aff_live_[0-9a-f]{48}$/)
      const storedHash = prisma.apiKey.create.mock.calls[0][0].data.keyHash
      expect(storedHash).toBe(sha256(result.key))
      expect(storedHash).not.toContain(result.key)
    })
    it('defaults scopes to orders.write when none provided', async () => {
      prisma.apiKey.create.mockImplementation((args: any) => ({ id: 'k', name: args.data.name, scopes: args.data.scopes, createdAt: new Date() }))
      await service.create('org-1', { name: 'NoScopes' } as any)
      expect(prisma.apiKey.create.mock.calls[0][0].data.scopes).toEqual(['orders.write'])
    })
    it('generates unique keys on each call', async () => {
      prisma.apiKey.create.mockImplementation((args: any) => ({ id: 'k', name: args.data.name, scopes: args.data.scopes, createdAt: new Date() }))
      const a = await service.create('org-1', { name: 'A' })
      const b = await service.create('org-1', { name: 'B' })
      expect(a.key).not.toBe(b.key)
    })
  })

  describe('verify', () => {
    it('rejects keys without the correct prefix', async () => {
      await expect(service.verify('bad_key_123')).rejects.toBeInstanceOf(UnauthorizedException)
    })
    it('rejects unknown keys', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null)
      await expect(service.verify('aff_live_' + 'a'.repeat(48))).rejects.toBeInstanceOf(UnauthorizedException)
    })
    it('returns record and updates lastUsedAt for a valid key', async () => {
      const raw = 'aff_live_' + 'b'.repeat(48)
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'k-1', organizationId: 'org-1', scopes: ['orders.write'] })
      const rec = await service.verify(raw)
      expect(rec.id).toBe('k-1')
      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({ where: { keyHash: sha256(raw) } })
      expect(prisma.apiKey.update).toHaveBeenCalled()
    })
  })

  describe('revoke', () => {
    it('throws NotFound when key belongs to another org', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null)
      await expect(service.revoke('org-1', 'k-x')).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.apiKey.delete).not.toHaveBeenCalled()
    })
    it('deletes an owned key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'k-1', organizationId: 'org-1' })
      const result = await service.revoke('org-1', 'k-1')
      expect(result).toEqual({ revoked: true })
      expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'k-1' } })
    })
  })

  describe('list', () => {
    it('never selects keyHash', async () => {
      prisma.apiKey.findMany.mockResolvedValue([])
      await service.list('org-1')
      const select = prisma.apiKey.findMany.mock.calls[0][0].select
      expect(select.keyHash).toBeUndefined()
      expect(select.name).toBe(true)
    })
  })
})
