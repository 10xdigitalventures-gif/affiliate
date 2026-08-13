import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes } from 'crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import * as templates from '../mail/templates'
import { LoginDto } from './dto/login.dto'
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  InviteDto,
  ResetPasswordDto,
} from './dto/auth.dto'
import { generateSecret, verifyToken, otpauthUrl, generateRecoveryCodes } from './totp'
import { TenantResolverService } from '../common/tenant/tenant-resolver.service'
import { runUnscoped } from '../prisma/tenant-context'

type ClientCtx = { userAgent?: string; ipAddress?: string; hostname?: string }

/**
 * Upper bound on how many same-email accounts one login attempt will check.
 * Keeps the argon2 cost of an unscoped attempt bounded.
 */
const MAX_CANDIDATE_ACCOUNTS = 10

/** Roles and permissions required to build a JWT payload. */
const USER_AUTH_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} as const

const REFRESH_TTL_S = Number(process.env.JWT_REFRESH_TTL) || 604800 // 7d
const RESET_TTL_S = Number(process.env.PASSWORD_RESET_TTL) || 3600 // 1h
const INVITE_TTL_S = Number(process.env.INVITE_TTL) || 604800 // 7d

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function randomToken(): string {
  return randomBytes(32).toString('hex')
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly tenants: TenantResolverService,
  ) {}

  // ── Core credential + payload helpers ────────────────────────────────────
  /**
   * Every account matching an address, optionally restricted to one tenant.
   * `User` is unique on [organizationId, email] rather than on email alone, so
   * an unscoped lookup can legitimately match several rows. Never use
   * `findFirst({ where: { email } })` here: it silently picks an arbitrary
   * tenant's account.
   */
  private async findAccountsByEmail(email: string, organizationId?: string | null) {
    const emailLc = email.trim().toLowerCase()
    // Credential lookup necessarily precedes knowing the tenant. Scoping is
    // applied explicitly below via `organizationId`, not by the middleware.
    return runUnscoped('login: resolve account before the tenant is known', () =>
      this.prisma.user.findMany({
      where: {
        email: { equals: emailLc, mode: 'insensitive' as const },
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        ...USER_AUTH_INCLUDE,
        organization: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: organizationId ? 1 : MAX_CANDIDATE_ACCOUNTS,
      }),
    )
  }

  /**
   * Verify a password against the candidate accounts and return those it
   * unlocks. Every candidate is checked rather than short-circuiting, so
   * response time does not reveal how many workspaces the address belongs to.
   */
  private async verifyCredentials(email: string, password: string, organizationId?: string | null) {
    const candidates = await this.findAccountsByEmail(email, organizationId)
    const matches: typeof candidates = []
    for (const user of candidates) {
      let ok = false
      try {
        ok = await argon2.verify(user.passwordHash, password)
      } catch {
        ok = false // unreadable or legacy hash counts as a failed attempt
      }
      if (ok) matches.push(user)
    }
    return matches
  }

  /** Account status gates, applied only once the password has been proven. */
  private assertLoginable(user: { status: string }) {
    if (user.status === 'suspended') throw new UnauthorizedException('Account suspended')
    if (user.status === 'invited') {
      throw new UnauthorizedException('Please accept your invitation to set a password')
    }
  }

  /**
   * Authenticate within a single tenant. Callers that cannot present a
   * workspace-selection step must pass `organizationId`; an ambiguous match is
   * rejected rather than resolved arbitrarily.
   */
  async validateUser(email: string, password: string, organizationId?: string | null) {
    const matches = await this.verifyCredentials(email, password, organizationId)
    if (matches.length === 0) throw new UnauthorizedException('Invalid credentials')
    if (matches.length > 1) {
      throw new UnauthorizedException(
        'This email belongs to several workspaces \u2014 sign in from your workspace URL',
      )
    }
    this.assertLoginable(matches[0])
    return matches[0]
  }

  private async buildPayload(userId: string) {
    // Builds the very context the middleware later relies on, so it cannot be
    // scoped by it. Lookups are by primary key / unique id, not by tenant.
    const user = await runUnscoped('auth: build JWT payload for a known user id', () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      }),
    )
    if (!user) throw new UnauthorizedException('User not found')
    const permissions = user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))
    const affiliate = await runUnscoped('auth: resolve affiliate id for JWT payload', () =>
      this.prisma.affiliate.findUnique({ where: { userId: user.id } }),
    )
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

  private async issueTokens(userId: string, ctx: ClientCtx = {}) {
    const { user, payload } = await this.buildPayload(userId)
    const access_token = await this.jwt.signAsync(payload)
    const refreshRaw = randomToken()
    await this.prisma.refreshToken.create({
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
        organizationId: user.organizationId,
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
  /**
   * Tenant-first login.
   *
   * The workspace is resolved before the credential check, from an explicit
   * `orgSlug` or from the Host header (white-label login domain or
   * `<slug>.<root-domain>` subdomain). When no tenant can be resolved and the
   * address unlocks accounts in more than one workspace, the caller receives a
   * short-lived selection challenge instead of tokens for an arbitrary tenant.
   */
  async login(dto: LoginDto, ctx: ClientCtx = {}) {
    const tenant = await this.tenants.resolve({ orgSlug: dto.orgSlug, hostname: ctx.hostname })
    // An explicitly named but unknown workspace must fail exactly like a wrong
    // password, otherwise this endpoint becomes a workspace-enumeration oracle.
    if (dto.orgSlug && !tenant) throw new UnauthorizedException('Invalid credentials')

    const matches = await this.verifyCredentials(dto.email, dto.password, tenant?.id ?? null)
    if (matches.length === 0) throw new UnauthorizedException('Invalid credentials')

    if (matches.length > 1) {
      // The password is already proven for each of these accounts, so naming
      // the workspaces discloses nothing the caller does not already control.
      const challenge = await this.jwt.signAsync(
        { userIds: matches.map((u) => u.id), purpose: 'workspace' },
        { expiresIn: 300 },
      )
      return {
        workspaceSelectionRequired: true as const,
        challenge,
        workspaces: matches.map((u) => ({ slug: u.organization.slug, name: u.organization.name })),
      }
    }

    return this.completeLogin(matches[0], ctx)
  }

  /**
   * Second step of an ambiguous login. The challenge pins the exact set of
   * accounts the password unlocked, so no further credential check is required
   * and the challenge cannot reach any other account.
   */
  async selectWorkspace(challenge: string, orgSlug: string, ctx: ClientCtx = {}) {
    let claims: { userIds?: unknown; purpose?: unknown }
    try {
      claims = await this.jwt.verifyAsync(challenge)
    } catch {
      throw new UnauthorizedException('Invalid or expired workspace selection')
    }
    if (claims.purpose !== 'workspace' || !Array.isArray(claims.userIds)) {
      throw new UnauthorizedException('Invalid or expired workspace selection')
    }
    const userIds = claims.userIds.filter((id): id is string => typeof id === 'string')
    // The challenge itself pins which accounts are reachable, so this lookup is
    // safe to run before a tenant context exists.
    const user = await runUnscoped('login: exchange workspace-selection challenge', () =>
      this.prisma.user.findFirst({
        where: { id: { in: userIds }, organization: { slug: orgSlug.trim().toLowerCase() } },
        include: USER_AUTH_INCLUDE,
      }),
    )
    if (!user) throw new UnauthorizedException('Invalid or expired workspace selection')
    return this.completeLogin(user, ctx)
  }

  /** Shared tail of every successful password login. */
  private async completeLogin(
    user: { id: string; status: string; twoFactorEnabled: boolean },
    ctx: ClientCtx,
  ) {
    this.assertLoginable(user)
    // When 2FA is on, do NOT issue tokens yet — hand back a short-lived challenge
    // that must be exchanged (with a TOTP or recovery code) at /auth/2fa/verify.
    if (user.twoFactorEnabled) {
      const challenge = await this.jwt.signAsync({ sub: user.id, purpose: '2fa' }, { expiresIn: 300 })
      return { twoFactorRequired: true as const, challenge }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return this.issueTokens(user.id, ctx)
  }

  // ── Two-factor authentication (TOTP) ──────────────────────────────────────
  /** Step 1: generate a secret + otpauth URL for the authenticator app. */
  async startTwoFactorSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    const secret = generateSecret()
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } })
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
    if (!verifyToken(user.twoFactorSecret, code)) throw new BadRequestException('Invalid authentication code')
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
    const valid = verifyToken(user.twoFactorSecret, code) || user.twoFactorRecoveryCodes.includes(sha256(code.trim()))
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
    if (verifyToken(user.twoFactorSecret, code)) {
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
      clientSecret: str(s.clientSecret),
      authorizationUrl: str(s.authorizationUrl),
      tokenUrl: str(s.tokenUrl),
      userinfoUrl: str(s.userinfoUrl),
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
  async ssoAuthorizeUrl(slug: string, redirectUri?: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } })
    if (!org) throw new NotFoundException('Organization not found')
    const cfg = this.ssoConfigFrom(org.settings)
    if (!cfg.enabled || !cfg.authorizationUrl || !cfg.clientId) {
      throw new BadRequestException('SSO is not configured for this organization')
    }
    const state = await this.jwt.signAsync(
      { org: org.id, slug, redirectUri: redirectUri ?? null, purpose: 'sso' },
      { expiresIn: 600 },
    )
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: this.ssoCallbackUrl(),
      scope: cfg.scopes,
      state,
    })
    return { url: `${cfg.authorizationUrl}?${params.toString()}` }
  }

  private async resolveSsoEmail(cfg: { userinfoUrl: string }, tokenJson: Record<string, unknown>) {
    // Prefer id_token claims; fall back to the userinfo endpoint.
    const idToken = tokenJson.id_token
    if (typeof idToken === 'string' && idToken.split('.').length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'))
        if (typeof payload.email === 'string') return { email: payload.email as string, name: typeof payload.name === 'string' ? (payload.name as string) : null }
      } catch {
        // fall through to userinfo
      }
    }
    if (cfg.userinfoUrl && typeof tokenJson.access_token === 'string') {
      const uiRes = await fetch(cfg.userinfoUrl, { headers: { authorization: `Bearer ${tokenJson.access_token}` } })
      if (uiRes.ok) {
        const ui = (await uiRes.json()) as Record<string, unknown>
        if (typeof ui.email === 'string') return { email: ui.email, name: typeof ui.name === 'string' ? ui.name : null }
      }
    }
    return null
  }

  /** Handle the IdP redirect: exchange the code, resolve the user, and issue tokens. */
  async ssoCallback(code: string, state: string, ctx: ClientCtx = {}) {
    let decoded: { org: string; slug: string; redirectUri?: string | null; purpose?: string }
    try {
      decoded = await this.jwt.verifyAsync(state)
      if (decoded.purpose !== 'sso') throw new Error('bad state')
    } catch {
      throw new UnauthorizedException('Invalid or expired SSO state')
    }
    const org = await this.prisma.organization.findUnique({ where: { id: decoded.org } })
    if (!org) throw new NotFoundException('Organization not found')
    const cfg = this.ssoConfigFrom(org.settings)
    if (!cfg.enabled) throw new BadRequestException('SSO is not enabled')

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.ssoCallbackUrl(),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
    })
    if (!tokenRes.ok) throw new UnauthorizedException('SSO token exchange failed')
    const tokenJson = (await tokenRes.json()) as Record<string, unknown>

    const resolved = await this.resolveSsoEmail(cfg, tokenJson)
    if (!resolved) throw new UnauthorizedException('Could not resolve email from SSO provider')
    const emailLc = resolved.email.toLowerCase()
    const domain = emailLc.split('@')[1] || ''
    if (cfg.allowedDomains.length && !cfg.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
      throw new UnauthorizedException('Email domain is not allowed for SSO')
    }

    let user = await this.prisma.user.findFirst({ where: { organizationId: org.id, email: emailLc } })
    if (!user) {
      if (!cfg.autoProvision) throw new UnauthorizedException('No account for this email; contact your administrator')
      user = await this.prisma.user.create({
        data: {
          organizationId: org.id,
          email: emailLc,
          fullName: resolved.name ?? emailLc.split('@')[0],
          status: 'active',
          emailVerifiedAt: new Date(),
          ssoProvider: cfg.provider,
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
      data: { lastLoginAt: new Date(), status: user.status === 'invited' ? 'active' : user.status, ssoProvider: cfg.provider },
    })
    const tokens = await this.issueTokens(user.id, ctx)
    const base = decoded.redirectUri || process.env.APP_URL || 'http://localhost:3000'
    return { tokens, redirectUri: base }
  }

  // ── Refresh with rotation + reuse detection ──────────────────────────────
  async refresh(refreshRaw: string, ctx: ClientCtx = {}) {
    const tokenHash = sha256(refreshRaw)
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })
    if (!existing) throw new UnauthorizedException('Invalid refresh token')

    // Reuse detection: a previously-rotated (revoked) token is being presented →
    // treat as a breach and revoke every active token for that user.
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked')
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired')
    }

    // Rotate: mint a new token, then revoke the old one pointing at the new.
    const result = await this.issueTokens(existing.userId, ctx)
    const newHash = sha256(result.refresh_token)
    const replacement = await this.prisma.refreshToken.findUnique({ where: { tokenHash: newHash } })
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: replacement?.id ?? null },
    })
    return result
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
      organizationId: user.organizationId,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      twoFactorEnabled: user.twoFactorEnabled,
      permissions: payload.permissions,
      affiliateId: payload.affiliateId,
      isSuperAdmin: payload.isSuperAdmin ?? false,
    }
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
    return { ok: true }
  }

  // ── Forgot / reset password ──────────────────────────────────────────────
  /**
   * Tenant-scoped password reset. Scoping matters as much as it does for login:
   * an unscoped `findFirst` would mail a reset link for an arbitrary
   * workspace's account, which for the recipient looks like a link that resets
   * the wrong login. When no tenant is resolvable, one clearly-labelled link is
   * sent per workspace the address belongs to.
   */
  async forgotPassword(dto: ForgotPasswordDto, ctx: ClientCtx = {}) {
    const tenant = await this.tenants.resolve({ orgSlug: dto.orgSlug, hostname: ctx.hostname })
    // Always return ok to avoid leaking which emails or workspaces exist.
    if (dto.orgSlug && !tenant) return { ok: true }

    const users = await runUnscoped('password reset: find accounts before the tenant is known', () =>
      this.prisma.user.findMany({
        where: {
          email: { equals: dto.email.trim().toLowerCase(), mode: 'insensitive' as const },
          ...(tenant ? { organizationId: tenant.id } : {}),
        },
        include: { organization: true },
        orderBy: { createdAt: 'asc' },
        take: tenant ? 1 : MAX_CANDIDATE_ACCOUNTS,
      }),
    )

    const appUrl = process.env.APP_URL || 'http://localhost:3000'
    for (const user of users) {
      if (user.status === 'suspended') continue

      const raw = randomToken()
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + RESET_TTL_S * 1000),
        },
      })
      // The slug lets the reset page name the workspace being reset, so a user
      // with several accounts can tell the links apart.
      const params = new URLSearchParams({ token: raw })
      if (user.organization?.slug) params.set('workspace', user.organization.slug)
      const tpl = templates.passwordReset({
        orgName: user.organization?.name ?? 'your account',
        firstName: (user.fullName || 'there').split(' ')[0],
        resetUrl: `${appUrl}/reset-password?${params.toString()}`,
        ttlMinutes: Math.round(RESET_TTL_S / 60),
      })
      await this.mail.send({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }
    return { ok: true }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(dto.token) } })
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired reset token')
    }
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await argon2.hash(dto.password) },
    })
    await this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
    // Invalidate any other outstanding reset tokens and active sessions.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    })
    await this.prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { ok: true }
  }

  // ── Invitations ──────────────────────────────────────────────────────────
  async invite(dto: InviteDto, organizationId: string, invitedByUserId: string) {
    const existingUser = await this.prisma.user.findFirst({
      where: { organizationId, email: dto.email },
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
    const user =
      existingUser ??
      (await this.prisma.user.create({
        data: {
          organizationId,
          email: dto.email,
          fullName: dto.fullName,
          status: 'invited',
          passwordHash: await argon2.hash(randomToken()),
        },
      }))

    const raw = randomToken()
    await this.prisma.invitation.create({
      data: {
        organizationId,
        email: dto.email,
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
    await this.mail.send({ to: dto.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    return { ok: true, userId: user.id }
  }

  async acceptInvite(dto: AcceptInviteDto, ctx: ClientCtx = {}) {
    const invite = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(dto.token) } })
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired invitation')
    }
    const user = await this.prisma.user.findFirst({
      where: { organizationId: invite.organizationId, email: invite.email },
    })
    if (!user) throw new NotFoundException('Invited user not found')

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: dto.fullName ?? user.fullName,
        passwordHash: await argon2.hash(dto.password),
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    })
    if (invite.roleId) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: invite.roleId } },
        create: { userId: user.id, roleId: invite.roleId },
        update: {},
      })
    }
    await this.prisma.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } })
    return this.issueTokens(user.id, ctx)
  }

  // ── Account deletion / GDPR right to erasure ─────────────────────────────
  // Anonymizes all PII stored on the user row and revokes every active session.
  // The user row itself is kept to preserve referential integrity (affiliate
  // records, audit logs, commission history) but contains no recoverable data.
  async deleteAccount(userId: string) {
    // 1. Revoke all refresh sessions immediately.
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
    // 2. Overwrite PII with anonymous values.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@account.invalid`,
        fullName: 'Deleted Account',
        passwordHash: await argon2.hash(randomToken()), // random → unguessable
        twoFactorSecret: null,
        twoFactorEnabled: false,
        twoFactorRecoveryCodes: [],
        status: 'suspended',
      },
    })
    return { ok: true, message: 'Account data anonymized and all sessions revoked.' }
  }

  static hash(password: string) {
    return argon2.hash(password)
  }
}
