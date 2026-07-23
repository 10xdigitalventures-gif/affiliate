import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { OidcService } from './oidc.service'
import { EntitlementsService } from '../entitlements/entitlements.service'
import * as templates from '../mail/templates'
import { LoginDto } from './dto/login.dto'
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  InviteDto,
  RequestEmailLoginCodeDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailLoginCodeDto,
} from './dto/auth.dto'
import { generateSecret, verifyToken, otpauthUrl, generateRecoveryCodes } from './totp'

type ClientCtx = { userAgent?: string; ipAddress?: string }

const REFRESH_TTL_S = Number(process.env.JWT_REFRESH_TTL) || 604800 // 7d
const RESET_TTL_S = Number(process.env.PASSWORD_RESET_TTL) || 3600 // 1h
const INVITE_TTL_S = Number(process.env.INVITE_TTL) || 604800 // 7d
const EMAIL_CODE_TTL_S = Number(process.env.EMAIL_LOGIN_CODE_TTL) || 600 // 10m
const EMAIL_CODE_MAX_ATTEMPTS = 5

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function randomToken(): string {
  return randomBytes(32).toString('hex')
}

function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function safeRedirectPath(value?: string | null): string {
  if (!value || value.length > 500 || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

function emailCodeHash(challenge: string, code: string): string {
  const secret = process.env.JWT_ACCESS_SECRET || 'development-only-email-code-secret'
  return createHmac('sha256', secret).update(`${challenge}:${code}`).digest('hex')
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly crypto: CryptoService,
    private readonly oidc: OidcService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ── Core credential + payload helpers ────────────────────────────────────
  async validateUser(email: string, password: string, workspace?: string) {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: email.trim().toLowerCase(),
        ...(workspace ? { organization: { slug: workspace.trim().toLowerCase() } } : {}),
      },
      include: {
        organization: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    })
    const matches: typeof candidates = []
    for (const candidate of candidates) {
      try {
        if (await argon2.verify(candidate.passwordHash, password)) matches.push(candidate)
      } catch {
        // A malformed legacy hash must behave exactly like an invalid password.
      }
    }
    // Email is tenant-scoped in the schema. If the same credentials match more
    // than one workspace, refuse to guess which identity should receive tokens.
    if (matches.length !== 1) throw new UnauthorizedException('Invalid credentials')
    const user = matches[0]
    if (user.status === 'suspended') throw new UnauthorizedException('Account suspended')
    if (user.organization?.status === 'suspended' && !user.isSuperAdmin) {
      throw new UnauthorizedException('Workspace suspended')
    }
    if (user.status === 'invited') throw new UnauthorizedException('Please accept your invitation to set a password')
    return user
  }

  private async buildPayload(
    userId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    })
    if (!user || user.status !== 'active') throw new UnauthorizedException('Session is no longer valid')
    if (user.organization?.status === 'suspended' && !user.isSuperAdmin) {
      throw new UnauthorizedException('Workspace suspended')
    }
    const permissions = user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))
    // A user may exist before their affiliate application is approved. Never
    // expose or mint portal context for pending/rejected/suspended affiliates.
    const affiliate = await db.affiliate.findFirst({
      where: { userId: user.id, status: 'approved' },
    })
    return {
      user,
      payload: {
        sub: user.id,
        organizationId: user.organizationId,
        permissions,
        affiliateId: affiliate?.id ?? null,
        isSuperAdmin: user.isSuperAdmin ?? false,
      },
    }
  }

  private async issueTokens(
    userId: string,
    ctx: ClientCtx = {},
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const { user, payload } = await this.buildPayload(userId, db)
    const access_token = await this.jwt.signAsync(payload)
    const refreshRaw = randomToken()
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshRaw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
      },
    })
    return {
      access_token,
      refresh_token: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl,
        organizationId: user.organizationId,
        organization: user.organization
          ? { id: user.organization.id, name: user.organization.name, slug: user.organization.slug }
          : undefined,
        permissions: payload.permissions,
        affiliateId: payload.affiliateId,
        isSuperAdmin: payload.isSuperAdmin,
      },
    }
  }

  /**
   * Public wrapper used by the Shopify embedded token-exchange to mint platform
   * tokens for an already-resolved user of the connected store's organization.
   */
  async issueTokensForUser(userId: string, ctx: ClientCtx = {}) {
    return this.issueTokens(userId, ctx)
  }

  // ── Login ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ctx: ClientCtx = {}) {
    const user = await this.validateUser(dto.email, dto.password, dto.workspace)
    // When 2FA is on, do NOT issue tokens yet — hand back a short-lived challenge
    // that must be exchanged (with a TOTP or recovery code) at /auth/2fa/verify.
    if (user.twoFactorEnabled) {
      const challenge = await this.jwt.signAsync({ sub: user.id, purpose: '2fa' }, { expiresIn: 300 })
      return { twoFactorRequired: true as const, challenge }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return this.issueTokens(user.id, ctx)
  }

  // ── Passwordless email-code login ───────────────────────────────────────
  async requestEmailLoginCode(dto: RequestEmailLoginCodeDto) {
    const email = dto.email.trim().toLowerCase()
    const candidates = await this.prisma.user.findMany({
      where: {
        email,
        ...(dto.workspace ? { organization: { slug: dto.workspace.trim().toLowerCase() } } : {}),
      },
      include: { organization: true },
      take: 2,
    })

    // Always return an indistinguishable challenge to prevent account/email
    // enumeration. Unknown, ambiguous, suspended and deleted accounts receive
    // no email and their challenge can never verify.
    const challenge = randomUrlToken(32)
    const user = candidates.length === 1 ? candidates[0] : null
    const eligible = user &&
      (user.status === 'active' || user.status === 'invited') &&
      (user.organization?.status !== 'suspended' || user.isSuperAdmin)
    if (!eligible) return { ok: true, challenge, expiresInSeconds: EMAIL_CODE_TTL_S }

    const now = new Date()
    const sixDigitCode = randomInt(0, 1_000_000).toString().padStart(6, '0')
    await this.prisma.$transaction(async (tx) => {
      await tx.emailLoginCode.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      })
      await tx.emailLoginCode.create({
        data: {
          userId: user.id,
          challengeHash: sha256(challenge),
          codeHash: emailCodeHash(challenge, sixDigitCode),
          expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_S * 1000),
        },
      })
    })

    const tpl = templates.emailLoginCode({
      orgName: user.organization?.name ?? 'Affiliate',
      settings: user.organization?.settings,
      firstName: (user.fullName || 'there').split(' ')[0],
      code: sixDigitCode,
      ttlMinutes: Math.round(EMAIL_CODE_TTL_S / 60),
    })
    await this.mail.send({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    return { ok: true, challenge, expiresInSeconds: EMAIL_CODE_TTL_S }
  }

  async verifyEmailLoginCode(dto: VerifyEmailLoginCodeDto, ctx: ClientCtx = {}) {
    const challenge = dto.challenge.trim()
    const now = new Date()
    const record = await this.prisma.emailLoginCode.findUnique({
      where: { challengeHash: sha256(challenge) },
      include: { user: { include: { organization: true } } },
    })
    const invalid = !record || record.usedAt || record.expiresAt <= now ||
      record.attempts >= EMAIL_CODE_MAX_ATTEMPTS
    if (invalid) throw new UnauthorizedException('Invalid or expired sign-in code')

    const validCode = hashesMatch(record.codeHash, emailCodeHash(challenge, dto.code.trim()))
    if (!validCode) {
      await this.prisma.emailLoginCode.updateMany({
        where: { id: record.id, usedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      })
      throw new UnauthorizedException('Invalid or expired sign-in code')
    }

    if (record.user.status === 'suspended' ||
        (record.user.organization?.status === 'suspended' && !record.user.isSuperAdmin)) {
      throw new UnauthorizedException('Invalid or expired sign-in code')
    }

    const consumed = await this.prisma.emailLoginCode.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS },
      },
      data: { usedAt: now },
    })
    if (consumed.count !== 1) throw new UnauthorizedException('Invalid or expired sign-in code')

    await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        status: 'active',
        emailVerifiedAt: record.user.emailVerifiedAt ?? now,
        lastLoginAt: now,
      },
    })

    if (record.user.twoFactorEnabled) {
      const twoFactorChallenge = await this.jwt.signAsync(
        { sub: record.userId, purpose: '2fa' },
        { expiresIn: 300 },
      )
      return { twoFactorRequired: true as const, challenge: twoFactorChallenge }
    }
    return this.issueTokens(record.userId, ctx)
  }

  // ── Two-factor authentication (TOTP) ──────────────────────────────────────
  /** Step 1: generate a secret + otpauth URL for the authenticator app. */
  async startTwoFactorSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    const secret = generateSecret()
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: this.crypto.encryptText(secret) } })
    const org = await this.prisma.organization.findUnique({ where: { id: user.organizationId } })
    return {
      secret,
      otpauthUrl: otpauthUrl({ secret, label: user.email, issuer: org?.name || 'Affiliate' }),
    }
  }

  /** Step 2: verify the first code, turn 2FA on, and hand back recovery codes once. */
  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.twoFactorSecret) throw new BadRequestException('Start 2FA setup first')
    if (user.twoFactorEnabled) throw new BadRequestException('Two-factor is already enabled')
    if (!verifyToken(this.crypto.decryptText(user.twoFactorSecret), code)) {
      throw new BadRequestException('Invalid authentication code')
    }
    const recoveryCodes = generateRecoveryCodes()
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorRecoveryCodes: recoveryCodes.map((c) => sha256(c)) },
    })
    return { ok: true, recoveryCodes }
  }

  /** Turn 2FA off (requires a valid TOTP or recovery code). */
  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return { ok: true }
    const valid = verifyToken(this.crypto.decryptText(user.twoFactorSecret), code) || user.twoFactorRecoveryCodes.includes(sha256(code.trim()))
    if (!valid) throw new BadRequestException('Invalid authentication code')
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: [] },
    })
    return { ok: true }
  }

  /** Exchange a login 2FA challenge + code for real tokens. */
  async verifyTwoFactor(challenge: string, code: string, ctx: ClientCtx = {}) {
    let sub: string
    try {
      const decoded = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(challenge)
      if (decoded.purpose !== '2fa') throw new Error('bad purpose')
      sub = decoded.sub
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA challenge')
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } })
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor is not enabled')
    }
    if (verifyToken(this.crypto.decryptText(user.twoFactorSecret), code)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      return this.issueTokens(user.id, ctx)
    }
    // One-time recovery code path (consumed on use).
    const hashed = sha256((code || '').trim())
    if (user.twoFactorRecoveryCodes.includes(hashed)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((c) => c !== hashed),
        },
      })
      return this.issueTokens(user.id, ctx)
    }
    throw new UnauthorizedException('Invalid authentication code')
  }

  // ── Single sign-on (OIDC / OAuth2 authorization-code) ─────────────────────
  private ssoConfigFrom(settings: unknown) {
    const s = (((settings ?? {}) as Record<string, unknown>).sso ?? {}) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      enabled: s.enabled === true,
      provider: str(s.provider) || 'oidc',
      clientId: str(s.clientId),
      clientSecret: this.crypto.decryptText(str(s.clientSecret)),
      issuerUrl: str(s.issuerUrl),
      scopes: str(s.scopes) || 'openid email profile',
      allowedDomains: Array.isArray(s.allowedDomains)
        ? (s.allowedDomains as unknown[]).filter((d): d is string => typeof d === 'string')
        : [],
      autoProvision: s.autoProvision === true,
      defaultRoleId: typeof s.defaultRoleId === 'string' ? s.defaultRoleId : null,
    }
  }

  private ssoCallbackUrl(): string {
    return (
      process.env.SSO_CALLBACK_URL ||
      `${process.env.API_PUBLIC_URL || 'http://localhost:4000/v1'}/auth/sso/callback`
    )
  }

  /** Build the IdP authorize URL for an org (looked up by slug on the public login page). */
  async ssoAuthorizeUrl(slug: string, redirectPath?: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } })
    if (!org) throw new NotFoundException('Organization not found')
    if (org.status === 'suspended') throw new UnauthorizedException('Workspace suspended')
    await this.entitlements.assertFeature(org.id, 'enterpriseSso')
    const cfg = this.ssoConfigFrom(org.settings)
    if (!cfg.enabled || !cfg.issuerUrl || !cfg.clientId || !cfg.clientSecret) {
      throw new BadRequestException('SSO is not configured for this organization')
    }
    const configuration = await this.oidc.discover(cfg.issuerUrl)
    const state = randomUrlToken()
    const nonce = randomUrlToken()
    const codeVerifier = randomUrlToken(48)
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    await this.prisma.ssoLoginState.create({
      data: {
        organizationId: org.id,
        stateHash: sha256(state),
        codeVerifier,
        nonce,
        redirectPath: safeRedirectPath(redirectPath),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })
    this.prisma.ssoLoginState
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } })
      .catch(() => undefined)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: this.ssoCallbackUrl(),
      scope: cfg.scopes,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return { url: `${configuration.authorization_endpoint}?${params.toString()}` }
  }

  /** Handle the IdP redirect: exchange the code, resolve the user, and issue tokens. */
  async ssoCallback(code: string, state: string, ctx: ClientCtx = {}) {
    if (!code || !state) throw new UnauthorizedException('Invalid SSO callback')
    const stateRecord = await this.prisma.ssoLoginState.findUnique({ where: { stateHash: sha256(state) } })
    if (!stateRecord || stateRecord.usedAt || stateRecord.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired SSO state')
    }
    const consumed = await this.prisma.ssoLoginState.updateMany({
      where: { id: stateRecord.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (consumed.count !== 1) throw new UnauthorizedException('SSO state has already been used')

    const org = await this.prisma.organization.findUnique({ where: { id: stateRecord.organizationId } })
    if (!org) throw new NotFoundException('Organization not found')
    if (org.status === 'suspended') throw new UnauthorizedException('Workspace suspended')
    await this.entitlements.assertFeature(org.id, 'enterpriseSso')
    const cfg = this.ssoConfigFrom(org.settings)
    if (!cfg.enabled || !cfg.issuerUrl || !cfg.clientId || !cfg.clientSecret) {
      throw new BadRequestException('SSO is not configured')
    }
    const configuration = await this.oidc.discover(cfg.issuerUrl)
    const tokenJson = await this.oidc.exchangeCode({
      configuration,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      codeVerifier: stateRecord.codeVerifier,
      redirectUri: this.ssoCallbackUrl(),
    })
    const resolved = await this.oidc.resolveIdentity({
      configuration,
      tokenJson,
      clientId: cfg.clientId,
      nonce: stateRecord.nonce,
    })
    const emailLc = resolved.email.trim().toLowerCase()
    const domain = emailLc.split('@')[1] || ''
    if (cfg.allowedDomains.length && !cfg.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
      throw new UnauthorizedException('Email domain is not allowed for SSO')
    }

    let user = await this.prisma.user.findFirst({
      where: { organizationId: org.id, ssoProvider: cfg.provider, ssoSubject: resolved.subject },
    })
    if (!user) {
      user = await this.prisma.user.findFirst({ where: { organizationId: org.id, email: emailLc } })
      if (user?.ssoSubject && (user.ssoProvider !== cfg.provider || user.ssoSubject !== resolved.subject)) {
        throw new UnauthorizedException('This account is already linked to another SSO identity')
      }
    }
    if (!user) {
      if (!cfg.autoProvision) throw new UnauthorizedException('No account for this email; contact your administrator')
      if (!cfg.defaultRoleId) throw new UnauthorizedException('SSO auto-provisioning has no default role')
      const role = await this.prisma.role.findFirst({
        where: { id: cfg.defaultRoleId, OR: [{ organizationId: org.id }, { organizationId: null }] },
      })
      if (!role) throw new UnauthorizedException('SSO default role is invalid')
      await this.entitlements.assertWithinLimit(org.id, 'teamMembers')
      user = await this.prisma.user.create({
        data: {
          organizationId: org.id,
          email: emailLc,
          fullName: resolved.name ?? emailLc.split('@')[0],
          status: 'active',
          emailVerifiedAt: new Date(),
          ssoProvider: cfg.provider,
          ssoSubject: resolved.subject,
          passwordHash: await argon2.hash(randomToken()),
        },
      })
      if (cfg.defaultRoleId) {
        await this.prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: cfg.defaultRoleId } },
          create: { userId: user.id, roleId: cfg.defaultRoleId },
          update: {},
        })
      }
    }
    if (user.status === 'suspended') throw new UnauthorizedException('Account suspended')
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        status: user.status === 'invited' ? 'active' : user.status,
        ssoProvider: cfg.provider,
        ssoSubject: resolved.subject,
      },
    })
    const exchangeCode = randomUrlToken()
    await this.prisma.loginExchangeCode.create({
      data: {
        userId: user.id,
        codeHash: sha256(exchangeCode),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return { exchangeCode, redirectPath: stateRecord.redirectPath }
  }

  /** Exchange the one-time browser bridge for normal auth tokens. */
  async exchangeSsoLogin(code: string, ctx: ClientCtx = {}) {
    const record = await this.prisma.loginExchangeCode.findUnique({ where: { codeHash: sha256(code) } })
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired sign-in code')
    }
    const consumed = await this.prisma.loginExchangeCode.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (consumed.count !== 1) throw new UnauthorizedException('Sign-in code has already been used')
    return this.issueTokens(record.userId, ctx)
  }

  // ── Refresh with rotation + reuse detection ──────────────────────────────
  async refresh(refreshRaw: string, ctx: ClientCtx = {}) {
    const tokenHash = sha256(refreshRaw)
    const initial = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })
    if (!initial) throw new UnauthorizedException('Invalid refresh token')

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialize refreshes for this identity across every API process. When a
      // duplicate request waits here, it sees the first rotation's committed
      // revoked state and takes the breach path below instead of minting a
      // second valid session.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refresh:${initial.userId}`}))`
      const existing = await tx.refreshToken.findUnique({ where: { tokenHash } })
      if (!existing) return { kind: 'invalid' as const }

      if (existing.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { userId: existing.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        // Return instead of throwing so the breach revocation is committed.
        return { kind: 'reuse' as const }
      }
      if (existing.expiresAt.getTime() < Date.now()) return { kind: 'expired' as const }

      const result = await this.issueTokens(existing.userId, ctx, tx)
      const replacement = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(result.refresh_token) },
      })
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedByTokenId: replacement?.id ?? null },
      })
      return { kind: 'success' as const, result }
    })

    if (outcome.kind === 'reuse') {
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked')
    }
    if (outcome.kind === 'expired') throw new UnauthorizedException('Refresh token expired')
    if (outcome.kind === 'invalid') throw new UnauthorizedException('Invalid refresh token')
    return outcome.result
  }

  // ── Logout ───────────────────────────────────────────────────────────────
  async logout(refreshRaw: string | undefined, userId: string, all = false) {
    if (all) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return { revoked: 'all' as const }
    }
    if (!refreshRaw) return { revoked: 'none' as const }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshRaw), userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { revoked: 'one' as const }
  }

  // ── Current user ─────────────────────────────────────────────────────────
  async me(userId: string) {
    const { user, payload } = await this.buildPayload(userId)
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl,
      organizationId: user.organizationId,
      organization: user.organization
        ? { id: user.organization.id, name: user.organization.name, slug: user.organization.slug }
        : undefined,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      twoFactorEnabled: user.twoFactorEnabled,
      permissions: payload.permissions,
      affiliateId: payload.affiliateId,
      isSuperAdmin: payload.isSuperAdmin ?? false,
    }
  }

  // ── Profile settings (authenticated) ───────────────────────────────────
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    const data: {
      fullName?: string
      email?: string
      phoneNumber?: string | null
      avatarUrl?: string | null
    } = {}

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim()
      if (!fullName) throw new BadRequestException('Name is required')
      data.fullName = fullName
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase()
      if (email !== user.email) {
        if (!dto.currentPassword) throw new BadRequestException('Current password is required to change your email')
        let passwordMatches = false
        try { passwordMatches = await argon2.verify(user.passwordHash, dto.currentPassword) } catch {}
        if (!passwordMatches) throw new BadRequestException('Current password is incorrect')
        const duplicate = await this.prisma.user.findFirst({
          where: { organizationId: user.organizationId, email, id: { not: userId } },
          select: { id: true },
        })
        if (duplicate) throw new ConflictException('An account with this email already exists')
        data.email = email
      }
    }

    if (dto.phoneNumber !== undefined) {
      data.phoneNumber = dto.phoneNumber?.trim() || null
    }
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = dto.avatarUrl?.trim() || null
    }

    await this.prisma.user.update({ where: { id: userId }, data })
    return this.me(userId)
  }

  // ── Change password (authenticated) ──────────────────────────────────────
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword)
    if (!ok) throw new BadRequestException('Current password is incorrect')
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword) },
    })
    // Security: revoke all other sessions after a password change.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await this.prisma.emailLoginCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })
    return { ok: true }
  }

  // ── Forgot / reset password ──────────────────────────────────────────────
  async forgotPassword(dto: ForgotPasswordDto) {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: dto.email.trim().toLowerCase(),
        ...(dto.workspace ? { organization: { slug: dto.workspace.trim().toLowerCase() } } : {}),
      },
      include: { organization: true },
      take: 2,
    })
    // Always return ok to avoid leaking which emails exist.
    const user = candidates.length === 1 ? candidates[0] : null
    if (!user || user.status === 'suspended') return { ok: true }

    const raw = randomToken()
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + RESET_TTL_S * 1000),
      },
    })
    const appUrl = process.env.APP_URL || 'http://localhost:3000'
    const resetUrl = `${appUrl}/reset-password?token=${raw}`
    const tpl = templates.passwordReset({
      orgName: user.organization?.name ?? 'your account',
      firstName: (user.fullName || 'there').split(' ')[0],
      resetUrl,
      ttlMinutes: Math.round(RESET_TTL_S / 60),
    })
    await this.mail.send({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    return { ok: true }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const passwordHash = await argon2.hash(dto.password)
    await this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(dto.token) } })
      if (!record || record.usedAt || record.expiresAt.getTime() < now.getTime()) {
        throw new BadRequestException('Invalid or expired reset token')
      }
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      if (consumed.count !== 1) throw new BadRequestException('Reset token has already been used')
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } })
      await tx.emailLoginCode.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      })
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      })
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      })
    })
    return { ok: true }
  }

  // ── Invitations ──────────────────────────────────────────────────────────
  async invite(dto: InviteDto, organizationId: string, invitedByUserId: string) {
    const email = dto.email.trim().toLowerCase()
    const existingUser = await this.prisma.user.findFirst({
      where: { organizationId, email },
    })
    if (existingUser && existingUser.status !== 'invited') {
      throw new ConflictException('A user with this email already exists')
    }
    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, OR: [{ organizationId }, { organizationId: null }] },
      })
      if (!role) throw new BadRequestException('Invalid role')
    }

    // Create (or keep) a placeholder invited user so roles can be attached on accept.
    if (!existingUser) await this.entitlements.assertWithinLimit(organizationId, 'teamMembers')
    const user =
      existingUser ??
      (await this.prisma.user.create({
        data: {
          organizationId,
          email,
          fullName: dto.fullName,
          status: 'invited',
          passwordHash: await argon2.hash(randomToken()),
        },
      }))

    const raw = randomToken()
    // Only the newest invitation remains valid. This prevents an old email link
    // from accepting a role that an administrator subsequently changed.
    await this.prisma.invitation.updateMany({
      where: { organizationId, email, acceptedAt: null },
      data: { acceptedAt: new Date() },
    })
    await this.prisma.invitation.create({
      data: {
        organizationId,
        email,
        roleId: dto.roleId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + INVITE_TTL_S * 1000),
        invitedByUserId,
      },
    })

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const appUrl = process.env.APP_URL || 'http://localhost:3000'
    const inviteUrl = `${appUrl}/accept-invite?token=${raw}`
    const tpl = templates.userInvite({
      orgName: org?.name ?? 'the team',
      inviteUrl,
      ttlDays: Math.round(INVITE_TTL_S / 86400),
      settings: org?.settings ?? null,
    })
    await this.mail.send({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    return { ok: true, userId: user.id }
  }

  /**
   * Link an approved affiliate to a login account. New/invited users receive a
   * one-time password setup link; an existing active user in the same workspace
   * is linked and receives the normal portal approval email.
   */
  async provisionAffiliateAccess(input: {
    affiliateId: string
    affiliateCode: string
    organizationId: string
    email: string
    fullName?: string
    firstName?: string
    invitedByUserId?: string
  }) {
    const email = input.email.trim().toLowerCase()
    const fullName = input.fullName?.trim() || undefined
    const firstName = input.firstName?.trim() || fullName?.split(/\s+/)[0] || 'there'
    const org = await this.prisma.organization.findUnique({ where: { id: input.organizationId } })
    if (!org) throw new NotFoundException('Organization not found')

    const raw = randomToken()
    const result = await this.prisma.$transaction(async (tx) => {
      const affiliate = await tx.affiliate.findFirst({
        where: { id: input.affiliateId, organizationId: input.organizationId },
      })
      if (!affiliate) throw new NotFoundException('Affiliate not found')

      const existingUser = await tx.user.findFirst({
        where: { organizationId: input.organizationId, email },
        include: { affiliate: true },
      })
      if (existingUser?.status === 'suspended') {
        throw new ConflictException('This email belongs to a suspended account')
      }
      if (existingUser?.affiliate && existingUser.affiliate.id !== affiliate.id) {
        throw new ConflictException('This user already has an affiliate account')
      }
      if (affiliate.userId && affiliate.userId !== existingUser?.id) {
        throw new ConflictException('This affiliate is already linked to another user')
      }

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            organizationId: input.organizationId,
            email,
            fullName,
            status: 'invited',
            passwordHash: await argon2.hash(randomToken()),
          },
        }))

      const setupRequired = user.status === 'invited'
      if (setupRequired) {
        await tx.invitation.create({
          data: {
            organizationId: input.organizationId,
            email,
            tokenHash: sha256(raw),
            expiresAt: new Date(Date.now() + INVITE_TTL_S * 1000),
            invitedByUserId: input.invitedByUserId,
          },
        })
      }

      await tx.affiliate.update({
        where: { id: affiliate.id },
        data: { userId: user.id },
      })

      return { userId: user.id, setupRequired }
    })

    const destinationUrl = result.setupRequired
      ? `${process.env.APP_URL || 'http://localhost:3000'}/accept-invite?token=${raw}`
      : `${process.env.APP_URL || 'http://localhost:3000'}/portal`
    const tpl = templates.applicationApproved({
      orgName: org.name,
      firstName,
      affiliateCode: input.affiliateCode,
      portalUrl: destinationUrl,
      setupRequired: result.setupRequired,
      settings: org.settings,
    })
    await this.mail.send({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })

    return { ok: true, userId: result.userId, invitationSent: result.setupRequired }
  }

  async acceptInvite(dto: AcceptInviteDto, ctx: ClientCtx = {}) {
    const passwordHash = await argon2.hash(dto.password)
    const userId = await this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const invite = await tx.invitation.findUnique({ where: { tokenHash: sha256(dto.token) } })
      if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < now.getTime()) {
        throw new BadRequestException('Invalid or expired invitation')
      }
      const consumed = await tx.invitation.updateMany({
        where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      })
      if (consumed.count !== 1) throw new BadRequestException('Invitation has already been used')
      const user = await tx.user.findFirst({
        where: { organizationId: invite.organizationId, email: invite.email },
      })
      if (!user) throw new NotFoundException('Invited user not found')
      if (invite.roleId) {
        const role = await tx.role.findFirst({
          where: { id: invite.roleId, OR: [{ organizationId: invite.organizationId }, { organizationId: null }] },
        })
        if (!role) throw new BadRequestException('Invitation role is no longer valid')
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          fullName: dto.fullName?.trim() || user.fullName,
          passwordHash,
          status: 'active',
          emailVerifiedAt: now,
        },
      })
      if (invite.roleId) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: invite.roleId } },
          create: { userId: user.id, roleId: invite.roleId },
          update: {},
        })
      }
      await tx.invitation.updateMany({
        where: { organizationId: invite.organizationId, email: invite.email, acceptedAt: null },
        data: { acceptedAt: now },
      })
      return user.id
    }, { isolationLevel: 'Serializable' })
    return this.issueTokens(userId, ctx)
  }

  // ── Account deletion / GDPR right to erasure ─────────────────────────────
  // Anonymizes all PII stored on the user row and revokes every active session.
  // The user row itself is kept to preserve referential integrity (affiliate
  // records, audit logs, commission history) but contains no recoverable data.
  async deleteAccount(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, isSuperAdmin: true, affiliate: { select: { id: true } } },
    })
    if (!user) throw new NotFoundException('User not found')
    if (user.isSuperAdmin) {
      throw new BadRequestException('A platform super-admin cannot self-delete; transfer platform ownership first')
    }
    let passwordMatches = false
    try { passwordMatches = await argon2.verify(user.passwordHash, currentPassword) } catch {}
    if (!passwordMatches) throw new UnauthorizedException('Current password is incorrect')

    const anonymizedPassword = await argon2.hash(randomToken(), { type: argon2.argon2id })
    const anonymizedEmail = `deleted_${randomToken()}@account.invalid`
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
      await tx.passwordResetToken.deleteMany({ where: { userId } })
      await tx.emailLoginCode.deleteMany({ where: { userId } })
      await tx.loginExchangeCode.deleteMany({ where: { userId } })
      await tx.shopifyStaffIdentity.deleteMany({ where: { userId } })
      await tx.userRole.deleteMany({ where: { userId } })

      if (user.affiliate) {
        await tx.payoutMethodRecord.updateMany({
          where: { affiliateId: user.affiliate.id },
          data: { detailsEnc: null, isDefault: false },
        })
        await tx.affiliate.update({
          where: { id: user.affiliate.id },
          data: { taxInfo: Prisma.DbNull, status: 'suspended' },
        })
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          fullName: 'Deleted Account',
          phoneNumber: null,
          avatarUrl: null,
          passwordHash: anonymizedPassword,
          emailVerifiedAt: null,
          twoFactorSecret: null,
          twoFactorEnabled: false,
          twoFactorRecoveryCodes: [],
          ssoProvider: null,
          ssoSubject: null,
          lastLoginAt: null,
          status: 'suspended',
        },
      })
    })
    return { ok: true, message: 'Account data anonymized and all sessions revoked.' }
  }

  static hash(password: string) {
    return argon2.hash(password)
  }
}
