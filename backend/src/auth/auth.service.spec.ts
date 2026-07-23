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
    emailCodes: [] as any[],
    users: [] as any[],
  }

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => db.users.find((u: any) => u.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) =>
        db.users.find((u: any) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        db.users.filter((u: any) => u.email === where.email),
      ),
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
    affiliate: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    organization: { findUnique: jest.fn(async () => ({ id: 'org1', name: 'Acme' })) },
    role: { findFirst: jest.fn(async () => ({ id: 'role1', organizationId: 'org1' })) },
    userRole: {
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
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
        let count = 0
        for (const t of db.resets) {
          if (where.id && t.id !== where.id) continue
          if (where.userId && t.userId !== where.userId) continue
          if (where.usedAt === null && t.usedAt) continue
          if (where.expiresAt?.gt && t.expiresAt <= where.expiresAt.gt) continue
          Object.assign(t, data)
          count++
        }
        return { count }
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    emailLoginCode: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: 'ec_' + (db.emailCodes.length + 1), attempts: 0, usedAt: null, ...data }
        db.emailCodes.push(t)
        return t
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const t = db.emailCodes.find((x: any) => x.challengeHash === where.challengeHash)
        if (!t) return null
        return { ...t, user: db.users.find((u: any) => u.id === t.userId) }
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0
        for (const t of db.emailCodes) {
          if (where.id && t.id !== where.id) continue
          if (where.userId && t.userId !== where.userId) continue
          if (where.usedAt === null && t.usedAt) continue
          if (where.expiresAt?.gt && t.expiresAt <= where.expiresAt.gt) continue
          if (where.attempts?.lt !== undefined && t.attempts >= where.attempts.lt) continue
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'object' && 'increment' in value) {
              t[key] = (t[key] ?? 0) + (value as any).increment
            } else {
              t[key] = value
            }
          }
          count++
        }
        return { count }
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = db.emailCodes.length
        db.emailCodes = db.emailCodes.filter((t: any) => where.userId && t.userId !== where.userId)
        return { count: before - db.emailCodes.length }
      }),
    },
    loginExchangeCode: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    shopifyStaffIdentity: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    payoutMethodRecord: { updateMany: jest.fn(async () => ({ count: 0 })) },
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
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0
        for (const t of db.invites) {
          if (where.id && t.id !== where.id) continue
          if (where.organizationId && t.organizationId !== where.organizationId) continue
          if (where.email && t.email !== where.email) continue
          if (where.acceptedAt === null && t.acceptedAt) continue
          if (where.expiresAt?.gt && t.expiresAt <= where.expiresAt.gt) continue
          Object.assign(t, data)
          count++
        }
        return { count }
      }),
    },
    $transaction: jest.fn(async (work: any) => typeof work === 'function' ? work(prisma) : Promise.all(work)),
    $executeRaw: jest.fn(async () => 1),
  }

  const jwt: any = { signAsync: jest.fn(async () => 'access.jwt.token') }
  const mail: any = { send: jest.fn(async () => undefined) }
  const crypto: any = {
    encryptText: jest.fn((value: string) => `enc:v1:${value}`),
    decryptText: jest.fn((value: string) => value.startsWith('enc:v1:') ? value.slice(7) : value),
  }
  const oidc: any = {}
  const entitlements: any = { assertFeature: jest.fn(async () => undefined) }
  const service = new AuthService(prisma, jwt, mail, crypto, oidc, entitlements)
  return { service, prisma, db, mail }
}

async function seedUser(db: any, over: any = {}) {
  const u = {
    id: 'u1',
    organizationId: 'org1',
    email: 'a@b.com',
    fullName: 'Ada Lovelace',
    status: 'active',
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    isSuperAdmin: false,
    organization: { id: 'org1', name: 'Acme', slug: 'acme', status: 'active', settings: {} },
    passwordHash: await argon2.hash('password123'),
    roles: [],
    ...over,
  }
  db.users.push(u)
  return u
}

describe('AuthService token lifecycle', () => {
  it('login issues an access + opaque refresh token and stores its hash', async () => {
    const { service, db, prisma } = makeService()
    await seedUser(db)
    const res = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    expect(res.access_token).toBe('access.jwt.token')
    expect(res.refresh_token).toHaveLength(64)
    expect(db.refreshTokens).toHaveLength(1)
    expect(db.refreshTokens[0].tokenHash).toBe(sha(res.refresh_token))
    expect(prisma.affiliate.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'approved' },
    })
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

  it('does not refresh a session after the account is suspended', async () => {
    const { service, db } = makeService()
    const user = await seedUser(db)
    const first = await service.login({ email: 'a@b.com', password: 'password123' }) as any
    user.status = 'suspended'

    await expect(service.refresh(first.refresh_token)).rejects.toBeInstanceOf(UnauthorizedException)
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

  it('refuses ambiguous credentials shared by more than one tenant', async () => {
    const { service, db } = makeService()
    await seedUser(db, { id: 'u1', organizationId: 'org1' })
    await seedUser(db, { id: 'u2', organizationId: 'org2' })
    await expect(service.login({ email: 'a@b.com', password: 'password123' })).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe('AuthService email-code login', () => {
  it('emails a six-digit code and stores only its keyed hash', async () => {
    const { service, db, mail } = makeService()
    await seedUser(db)

    const result = await service.requestEmailLoginCode({ email: 'A@B.COM' })

    expect(result.ok).toBe(true)
    expect(result.challenge.length).toBeGreaterThanOrEqual(32)
    expect(db.emailCodes).toHaveLength(1)
    expect(db.emailCodes[0].challengeHash).toBe(sha(result.challenge))
    expect(db.emailCodes[0].codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(db.emailCodes[0])).not.toMatch(/"code":"\d{6}"/)
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('verifies the emailed code once and activates the session', async () => {
    const { service, db, prisma, mail } = makeService()
    const user = await seedUser(db, { status: 'invited' })
    const requested = await service.requestEmailLoginCode({ email: 'a@b.com' })
    const body = mail.send.mock.calls[0][0].text as string
    const code = body.match(/Code: (\d{6})/)?.[1]
    expect(code).toMatch(/^\d{6}$/)

    const result = await service.verifyEmailLoginCode({ challenge: requested.challenge, code: code! }) as any
    expect(result.access_token).toBe('access.jwt.token')
    expect(db.emailCodes[0].usedAt).toBeTruthy()
    expect(user.status).toBe('active')
    expect(user.emailVerifiedAt).toBeTruthy()
    expect(prisma.refreshToken.create).toHaveBeenCalled()

    await expect(service.verifyEmailLoginCode({ challenge: requested.challenge, code: code! }))
      .rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('counts invalid attempts without revealing the correct code', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    const requested = await service.requestEmailLoginCode({ email: 'a@b.com' })

    await expect(service.verifyEmailLoginCode({ challenge: requested.challenge, code: '000000' }))
      .rejects.toBeInstanceOf(UnauthorizedException)
    expect(db.emailCodes[0].attempts).toBe(1)
  })

  it('returns the same public shape for an unknown address without sending mail', async () => {
    const { service, db, mail } = makeService()
    const result = await service.requestEmailLoginCode({ email: 'missing@example.com' })
    expect(result.ok).toBe(true)
    expect(result.expiresInSeconds).toBeGreaterThan(0)
    expect(result.challenge.length).toBeGreaterThanOrEqual(32)
    expect(db.emailCodes).toHaveLength(0)
    expect(mail.send).not.toHaveBeenCalled()
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

describe('AuthService account deletion', () => {
  it('requires the current password and refuses super-admin self-deletion', async () => {
    const { service, db } = makeService()
    await seedUser(db)
    await expect(service.deleteAccount('u1', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException)

    db.users[0].isSuperAdmin = true
    await expect(service.deleteAccount('u1', 'password123')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('anonymizes profile and identity fields transactionally', async () => {
    const { service, db, prisma } = makeService()
    const user = await seedUser(db, {
      phoneNumber: '+92 300 0000000',
      avatarUrl: 'https://example.com/avatar.jpg',
      ssoProvider: 'oidc',
      ssoSubject: 'subject-1',
      affiliate: null,
    })

    await expect(service.deleteAccount('u1', 'password123')).resolves.toMatchObject({ ok: true })
    expect(user.email).toMatch(/^deleted_.+@account\.invalid$/)
    expect(user.phoneNumber).toBeNull()
    expect(user.avatarUrl).toBeNull()
    expect(user.ssoSubject).toBeNull()
    expect(user.status).toBe('suspended')
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})
