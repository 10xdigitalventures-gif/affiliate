import { UnauthorizedException, BadRequestException } from '@nestjs/common'
import { createHash } from 'crypto'
import * as argon2 from 'argon2'
import { AuthService } from './auth.service'

/**
 * Prisma, JWT and mail are stubbed. We assert the token lifecycle logic:
 * refresh rotation, reuse detection, reset consumption, and invite accept.
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function makeService() {
  const db: any = {
    refreshTokens: [] as any[],
    resets: [] as any[],
    invites: [] as any[],
    users: [] as any[],
    orgs: [] as any[],
  }

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => db.users.find((u: any) => u.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          db.users.find((u: any) => {
            if (where.id?.in) return where.id.in.includes(u.id) && matchesUserWhere(u, where)
            if (where.id) return u.id === where.id
            return matchesUserWhere(u, where)
          }) ?? null
        )
      }),
      findMany: jest.fn(async ({ where, take }: any) => {
        const rows = db.users.filter((u: any) => matchesUserWhere(u, where))
        return typeof take === 'number' ? rows.slice(0, take) : rows
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = db.users.find((x: any) => x.id === where.id)
        Object.assign(u, data)
        return u
      }),
      create: jest.fn(async ({ data }: any) => {
        const u = { id: 'u_' + (db.users.length + 1), roles: [], ...data }
        db.users.push(u)
        return u
      }),
    },
    affiliate: { findUnique: jest.fn(async () => null) },
    organization: { findUnique: jest.fn(async () => ({ id: 'org1', name: 'Acme' })) },
    role: { findFirst: jest.fn(async () => ({ id: 'role1', organizationId: 'org1' })) },
    userRole: { upsert: jest.fn(async () => ({})) },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: 'rt_' + (db.refreshTokens.length + 1), revokedAt: null, ...data }
        db.refreshTokens.push(t)
        return t
      }),
      findUnique: jest.fn(async ({ where }: any) => db.refreshTokens.find((t: any) => t.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const t = db.refreshTokens.find((x: any) => x.id === where.id)
        Object.assign(t, data)
        return t
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0
        for (const t of db.refreshTokens) {
          if (where.userId && t.userId !== where.userId) continue
          if (where.tokenHash && t.tokenHash !== where.tokenHash) continue
          if (where.revokedAt === null && t.revokedAt) continue
          Object.assign(t, data)
          n++
        }
        return { count: n }
      }),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: 'pr_' + (db.resets.length + 1), usedAt: null, ...data }
        db.resets.push(t)
        return t
      }),
      findUnique: jest.fn(async ({ where }: any) => db.resets.find((t: any) => t.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const t = db.resets.find((x: any) => x.id === where.id)
        Object.assign(t, data)
        return t
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        for (const t of db.resets) {
          if (where.userId && t.userId !== where.userId) continue
          if (where.usedAt === null && t.usedAt) continue
          Object.assign(t, data)
        }
        return { count: 0 }
      }),
    },
    invitation: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: 'inv_' + (db.invites.length + 1), acceptedAt: null, ...data }
        db.invites.push(t)
        return t
      }),
      findUnique: jest.fn(async ({ where }: any) => db.invites.find((t: any) => t.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const t = db.invites.find((x: any) => x.id === where.id)
        Object.assign(t, data)
        return t
      }),
    },
  }

  // Signing returns an opaque string; verification round-trips the claims that
  // were signed so the workspace-selection challenge can be exercised.
  const signed = new Map<string, any>()
  let signCount = 0
  const jwt: any = {
    signAsync: jest.fn(async (claims: any) => {
      if (claims?.purpose !== 'workspace' && claims?.purpose !== '2fa') return 'access.jwt.token'
      const token = `${claims.purpose}.challenge.${++signCount}`
      signed.set(token, claims)
      return token
    }),
    verifyAsync: jest.fn(async (token: string) => {
      if (!signed.has(token)) throw new Error('invalid token')
      return signed.get(token)
    }),
  }
  const mail: any = { send: jest.fn(async () => undefined) }
  // Tenant resolution is stubbed; tests set `tenants.next` to the org a request
  // should resolve to, mirroring a login domain or an explicit workspace slug.
  const tenants: any = {
    next: null as null | { id: string; slug: string; name: string },
    resolve: jest.fn(async ({ orgSlug }: any) => {
      if (orgSlug) return db.orgs.find((o: any) => o.slug === orgSlug) ?? null
      return tenants.next
    }),
  }
  const service = new AuthService(prisma, jwt, mail, tenants)
  return { service, prisma, db, mail, tenants }
}

/** Mirrors the subset of Prisma `where` semantics the auth service relies on. */
function matchesUserWhere(u: any, where: any = {}): boolean {
  if (where.organizationId && u.organizationId !== where.organizationId) return false
  if (where.organization?.slug) {
    const org = u.__orgSlug ?? u.organization?.slug
    if (org !== where.organization.slug) return false
  }
  if (where.email) {
    const expected = typeof where.email === 'string' ? where.email : where.email.equals
    if (String(u.email).toLowerCase() !== String(expected).toLowerCase()) return false
  }
  return true
}

async function seedUser(db: any, over: any = {}) {
  const organizationId = over.organizationId ?? 'org1'
  const org = seedOrg(db, organizationId)
  const u = {
    id: 'u1',
    organizationId,
    email: 'a@b.com',
    fullName: 'Ada Lovelace',
    status: 'active',
    passwordHash: await argon2.hash('password123'),
    roles: [],
    organization: org,
    __orgSlug: org.slug,
    ...over,
  }
  db.users.push(u)
  return u
}

function seedOrg(db: any, id: string) {
  db.orgs = db.orgs ?? []
  const existing = db.orgs.find((o: any) => o.id === id)
  if (existing) return existing
  const org = { id, slug: id.replace(/[^a-z0-9-]/g, '-'), name: id.toUpperCase() }
  db.orgs.push(org)
  return org
}

describe('AuthService token lifecycle', () => {
  it('login issues an access + opaque refresh token and stores its hash', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    const res = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    expect(res.access_token).toBe('access.jwt.token')
    expect(res.refresh_token).toHaveLength(64)
    expect(db.refreshTokens).toHaveLength(1)
    expect(db.refreshTokens[0].tokenHash).toBe(sha(res.refresh_token))
  })

  it('refresh rotates the token and revokes the old one', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    const first = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    const rotated = await service.refresh(first.refresh_token)
    expect(rotated.refresh_token).not.toBe(first.refresh_token)
    const old = db.refreshTokens.find((t: any) => t.tokenHash === sha(first.refresh_token))
    expect(old.revokedAt).toBeTruthy()
    expect(old.replacedByTokenId).toBeTruthy()
  })

  it('reusing a rotated refresh token revokes all sessions (breach)', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    const first = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    await service.refresh(first.refresh_token) // rotates -> old now revoked
    await expect(service.refresh(first.refresh_token)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(db.refreshTokens.every((t: any) => t.revokedAt)).toBe(true)
  })

  it('logout revokes only the presented token', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    const a = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    const b = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    await service.logout(a.refresh_token, 'u1')
    expect(db.refreshTokens.find((t: any) => t.tokenHash === sha(a.refresh_token)).revokedAt).toBeTruthy()
    expect(db.refreshTokens.find((t: any) => t.tokenHash === sha(b.refresh_token)).revokedAt).toBeNull()
  })

  it('invited / suspended users cannot log in', async () => {
    const { service, db } = makeService()
    await seedUser(db, { id: 'u2', email: 'inv@b.com', status: 'invited' })
    await expect(service.login({ email: 'inv@b.com', password: 'password123' })).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe('AuthService password reset', () => {
  it('forgot -> reset consumes the token and updates the password', async () => {
    const { service, db } = makeService()
    const u = await seedUser(db)
    await service.forgotPassword({ email: 'a@b.com' })
    expect(db.resets).toHaveLength(1)
    // recover raw token by matching hash is impossible; instead re-derive via spy on create arg
    const rawHash = db.resets[0].tokenHash
    // find the raw token by brute-force is not feasible; assert reset rejects bad token and accepts via direct hash injection
    await expect(service.resetPassword({ token: 'wrong', password: 'newpassword1' })).rejects.toBeInstanceOf(BadRequestException)
    // Simulate the correct token by injecting a known one
    const knownRaw = 'known-raw-token'
    db.resets[0].tokenHash = sha(knownRaw)
    await service.resetPassword({ token: knownRaw, password: 'newpassword1' })
    expect(db.resets[0].usedAt).toBeTruthy()
    expect(await argon2.verify(u.passwordHash, 'newpassword1')).toBe(true)
    void rawHash
  })

  it('reset token cannot be reused', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    await service.forgotPassword({ email: 'a@b.com' })
    const knownRaw = 'known-raw-2'
    db.resets[0].tokenHash = sha(knownRaw)
    await service.resetPassword({ token: knownRaw, password: 'newpassword1' })
    await expect(service.resetPassword({ token: knownRaw, password: 'another12' })).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('AuthService invitations', () => {
  it('accept-invite activates the user, sets password and issues tokens', async () => {
    const { service, db } = makeService()
    await seedUser(db, { id: 'u3', email: 'new@b.com', status: 'invited', passwordHash: await argon2.hash('x') })
    db.invites.push({
      id: 'inv_1',
      organizationId: 'org1',
      email: 'new@b.com',
      roleId: 'role1',
      tokenHash: sha('invite-raw'),
      expiresAt: new Date(Date.now() + 3600_000),
      acceptedAt: null,
    })
    const res = await service.acceptInvite({ token: 'invite-raw', password: 'welcome123', fullName: 'New User' })
    expect(res.access_token).toBeTruthy()
    const u = db.users.find((x: any) => x.id === 'u3')
    expect(u.status).toBe('active')
    expect(u.emailVerifiedAt).toBeTruthy()
    expect(db.invites[0].acceptedAt).toBeTruthy()
  })

  it('expired invitation is rejected', async () => {
    const { service, db } = makeService()
    db.invites.push({
      id: 'inv_2', organizationId: 'org1', email: 'x@b.com', roleId: null,
      tokenHash: sha('expired-raw'), expiresAt: new Date(Date.now() - 1000), acceptedAt: null,
    })
    await expect(service.acceptInvite({ token: 'expired-raw', password: 'welcome123' })).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('AuthService tenant-first login (regression: C1)', () => {
  /**
   * `User` is unique on [organizationId, email], so the same address can exist
   * in several workspaces. Before this fix, login used
   * `findFirst({ where: { email } })` and authenticated whoever the database
   * happened to return first.
   */
  async function seedTwoWorkspaces() {
    const ctx = makeService()
    await seedUser(ctx.db, { id: 'u_acme', organizationId: 'acme', email: 'ada@example.com' })
    await seedUser(ctx.db, { id: 'u_globex', organizationId: 'globex', email: 'ada@example.com' })
    return ctx
  }

  it('signs in to the workspace resolved from the request, not an arbitrary one', async () => {
    const { service, db, tenants } = await seedTwoWorkspaces()
    tenants.next = db.orgs.find((o: any) => o.id === 'globex')

    const res = (await service.login({ email: 'ada@example.com', password: 'password123' })) as any

    expect(res.access_token).toBe('access.jwt.token')
    expect(res.user.organizationId).toBe('globex')
    expect(res.user.id).toBe('u_globex')
  })

  it('an explicit workspace slug selects that tenant', async () => {
    const { service } = await seedTwoWorkspaces()

    const res = (await service.login({
      email: 'ada@example.com',
      password: 'password123',
      orgSlug: 'acme',
    })) as any

    expect(res.user.organizationId).toBe('acme')
  })

  it('never authenticates into a workspace the address does not belong to', async () => {
    const ctx = makeService()
    await seedUser(ctx.db, { id: 'u_acme', organizationId: 'acme', email: 'ada@example.com' })
    seedOrg(ctx.db, 'globex')
    ctx.tenants.next = ctx.db.orgs.find((o: any) => o.id === 'globex')

    await expect(
      ctx.service.login({ email: 'ada@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('an unknown workspace slug fails like a wrong password, leaking nothing', async () => {
    const { service } = await seedTwoWorkspaces()

    await expect(
      service.login({ email: 'ada@example.com', password: 'password123', orgSlug: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('asks which workspace when the tenant is ambiguous, instead of guessing', async () => {
    const { service } = await seedTwoWorkspaces()

    const res = (await service.login({ email: 'ada@example.com', password: 'password123' })) as any

    expect(res.workspaceSelectionRequired).toBe(true)
    expect(res.access_token).toBeUndefined()
    expect(res.workspaces.map((w: any) => w.slug).sort()).toEqual(['acme', 'globex'])
  })

  it('the selection challenge only issues tokens for an account the password unlocked', async () => {
    const { service } = await seedTwoWorkspaces()
    const challenge = ((await service.login({
      email: 'ada@example.com',
      password: 'password123',
    })) as any).challenge

    const res = (await service.selectWorkspace(challenge, 'globex')) as any
    expect(res.user.organizationId).toBe('globex')

    // A workspace outside the challenge cannot be reached with it.
    await expect(service.selectWorkspace(challenge, 'initech')).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await expect(service.selectWorkspace('forged.token', 'acme')).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('a wrong password is rejected even when the address exists in several workspaces', async () => {
    const { service } = await seedTwoWorkspaces()

    await expect(
      service.login({ email: 'ada@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('status gates still apply after the tenant is resolved', async () => {
    const ctx = makeService()
    await seedUser(ctx.db, {
      id: 'u_susp',
      organizationId: 'acme',
      email: 'ada@example.com',
      status: 'suspended',
    })
    ctx.tenants.next = ctx.db.orgs.find((o: any) => o.id === 'acme')

    await expect(
      ctx.service.login({ email: 'ada@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe('AuthService tenant-scoped password reset (regression: C1)', () => {
  it('resets only the account in the resolved workspace', async () => {
    const ctx = makeService()
    await seedUser(ctx.db, { id: 'u_acme', organizationId: 'acme', email: 'ada@example.com' })
    await seedUser(ctx.db, { id: 'u_globex', organizationId: 'globex', email: 'ada@example.com' })
    ctx.tenants.next = ctx.db.orgs.find((o: any) => o.id === 'globex')

    await ctx.service.forgotPassword({ email: 'ada@example.com' })

    expect(ctx.db.resets).toHaveLength(1)
    expect(ctx.db.resets[0].userId).toBe('u_globex')
  })

  it('without a resolvable tenant, sends one clearly-labelled link per workspace', async () => {
    const ctx = makeService()
    await seedUser(ctx.db, { id: 'u_acme', organizationId: 'acme', email: 'ada@example.com' })
    await seedUser(ctx.db, { id: 'u_globex', organizationId: 'globex', email: 'ada@example.com' })

    await ctx.service.forgotPassword({ email: 'ada@example.com' })

    expect(ctx.db.resets.map((r: any) => r.userId).sort()).toEqual(['u_acme', 'u_globex'])
    expect(ctx.mail.send).toHaveBeenCalledTimes(2)
  })

  it('still answers ok for an address that does not exist', async () => {
    const ctx = makeService()
    await expect(ctx.service.forgotPassword({ email: 'nobody@example.com' })).resolves.toEqual({
      ok: true,
    })
    expect(ctx.db.resets).toHaveLength(0)
  })
})
