import { UnauthorizedException } from '@nestjs/common'
import { IdentityService } from './identity.service'
import { JwtStrategy } from './jwt.strategy'

/**
 * Regression cover for H1: a valid-but-stale access token must not keep
 * granting access after the underlying account changes.
 */
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret'

type UserRow = {
  id: string
  status: string
  organizationId: string
  isSuperAdmin?: boolean
  orgStatus?: string
  affiliateId?: string | null
  permissions?: string[]
}

function makePrisma(rows: UserRow[]) {
  const calls = { findUnique: 0 }
  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        calls.findUnique++
        const u = rows.find((r) => r.id === where.id)
        if (!u) return null
        return {
          id: u.id,
          status: u.status,
          organizationId: u.organizationId,
          isSuperAdmin: u.isSuperAdmin ?? false,
          organization: { status: u.orgStatus ?? 'active' },
          affiliate: u.affiliateId ? { id: u.affiliateId } : null,
          roles: [
            {
              role: {
                permissions: (u.permissions ?? []).map((key) => ({ permission: { key } })),
              },
            },
          ],
        }
      },
    },
  }
  return { prisma, calls }
}

/** A token whose claims are all stale/forged, to prove they are ignored. */
const STALE_TOKEN = {
  sub: 'u1',
  organizationId: 'org1',
  permissions: ['affiliates.delete', 'billing.manage'],
  affiliateId: 'aff_forged',
  isSuperAdmin: true,
}

beforeEach(() => {
  process.env.AUTH_IDENTITY_CACHE_MS = '0'
})

describe('JwtStrategy.validate', () => {
  it('rebuilds permissions from the database and ignores the token claims', async () => {
    const { prisma } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1', permissions: ['affiliates.read'] },
    ])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    const user = await strategy.validate(STALE_TOKEN as any)

    // The revoked permissions in the token must not survive.
    expect(user.permissions).toEqual(['affiliates.read'])
    expect(user.isSuperAdmin).toBe(false)
    expect(user.affiliateId).toBeNull()
  })

  it('rejects a token for a suspended user', async () => {
    const { prisma } = makePrisma([{ id: 'u1', status: 'suspended', organizationId: 'org1' }])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(strategy.validate(STALE_TOKEN as any)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token for an invited (not yet activated) user', async () => {
    const { prisma } = makePrisma([{ id: 'u1', status: 'invited', organizationId: 'org1' }])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(strategy.validate(STALE_TOKEN as any)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token when the whole organization is suspended', async () => {
    const { prisma } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1', orgStatus: 'suspended' },
    ])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(strategy.validate(STALE_TOKEN as any)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token for a user that no longer exists', async () => {
    const { prisma } = makePrisma([])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(strategy.validate(STALE_TOKEN as any)).rejects.toThrow(UnauthorizedException)
  })

  it('refuses a token whose organization does not match the account', async () => {
    // Tenant scoping keys off req.user.organizationId, so a mismatch is fatal.
    const { prisma } = makePrisma([{ id: 'u1', status: 'active', organizationId: 'org_real' }])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(
      strategy.validate({ sub: 'u1', organizationId: 'org_attacker' } as any),
    ).rejects.toThrow(/does not match/)
  })

  it('rejects a token with no subject', async () => {
    const { prisma } = makePrisma([])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    await expect(strategy.validate({} as any)).rejects.toThrow(UnauthorizedException)
  })

  it('returns the organization from the database, never from the token', async () => {
    const { prisma } = makePrisma([{ id: 'u1', status: 'active', organizationId: 'org1' }])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    const user = await strategy.validate({ sub: 'u1' } as any)

    expect(user.organizationId).toBe('org1')
  })

  it('surfaces a genuine super admin from the database', async () => {
    const { prisma } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1', isSuperAdmin: true },
    ])
    const strategy = new JwtStrategy(new IdentityService(prisma))

    const user = await strategy.validate({ sub: 'u1', isSuperAdmin: false } as any)

    expect(user.isSuperAdmin).toBe(true)
  })
})

describe('IdentityService caching', () => {
  it('does not hit the database twice inside the TTL', async () => {
    process.env.AUTH_IDENTITY_CACHE_MS = '5000'
    const { prisma, calls } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1' },
    ])
    const identity = new IdentityService(prisma)

    await identity.resolve('u1')
    await identity.resolve('u1')

    expect(calls.findUnique).toBe(1)
  })

  it('re-reads the database after invalidate()', async () => {
    process.env.AUTH_IDENTITY_CACHE_MS = '5000'
    const { prisma, calls } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1' },
    ])
    const identity = new IdentityService(prisma)

    await identity.resolve('u1')
    identity.invalidate('u1')
    await identity.resolve('u1')

    expect(calls.findUnique).toBe(2)
  })

  it('reads the database every time when caching is disabled', async () => {
    process.env.AUTH_IDENTITY_CACHE_MS = '0'
    const { prisma, calls } = makePrisma([
      { id: 'u1', status: 'active', organizationId: 'org1' },
    ])
    const identity = new IdentityService(prisma)

    await identity.resolve('u1')
    await identity.resolve('u1')

    expect(calls.findUnique).toBe(2)
  })

  it('caches a negative result so a deleted user cannot be probed cheaply', async () => {
    process.env.AUTH_IDENTITY_CACHE_MS = '5000'
    const { prisma, calls } = makePrisma([])
    const identity = new IdentityService(prisma)

    expect(await identity.resolve('ghost')).toBeNull()
    expect(await identity.resolve('ghost')).toBeNull()
    expect(calls.findUnique).toBe(1)
  })

  it('de-duplicates permissions granted by more than one role', async () => {
    process.env.AUTH_IDENTITY_CACHE_MS = '0'
    const { prisma } = makePrisma([
      {
        id: 'u1',
        status: 'active',
        organizationId: 'org1',
        permissions: ['affiliates.read', 'affiliates.read', 'payouts.read'],
      },
    ])
    const identity = new IdentityService(prisma)

    const result = await identity.resolve('u1')

    expect(result?.permissions).toEqual(['affiliates.read', 'payouts.read'])
  })
})
