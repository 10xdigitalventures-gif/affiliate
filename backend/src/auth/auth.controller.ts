import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import {
  AcceptInviteDto,
  ChangePasswordDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  InviteDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  RequestEmailLoginCodeDto,
  VerifyEmailLoginCodeDto,
  SsoExchangeDto,
  TwoFactorEnableDto,
  TwoFactorDisableDto,
  TwoFactorVerifyDto,
  UpdateProfileDto,
} from './dto/auth.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard, RequirePermissions } from '../common/guards/permissions.guard'
import { JwtPayload } from './jwt.strategy'
import {
  clearSessionCookies,
  REFRESH_COOKIE,
  readCookie,
  setSessionCookies,
} from './session-cookies'

function clientCtx(req: any) {
  return {
    userAgent: req.headers?.['user-agent'],
    // Express computes req.ip from the configured trusted-proxy boundary. Raw
    // x-forwarded-for is attacker-controlled when a request bypasses a proxy.
    ipAddress: typeof req.ip === 'string' ? req.ip.trim() || undefined : undefined,
  }
}

function completeSession(req: any, res: Response, result: { access_token: string; refresh_token: string; user: unknown }) {
  // Browser sessions receive credentials only as Secure + HttpOnly cookies.
  // Non-browser clients can opt into a bearer payload in development, or only
  // when an operator explicitly enables it in production. This prevents an
  // injected browser script from downgrading an HttpOnly session into tokens
  // that JavaScript can read and exfiltrate.
  if (String(req.headers?.['x-auth-mode'] || '').toLowerCase() === 'bearer') {
    const bearerAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_BEARER_AUTH === 'true'
    if (!bearerAllowed) throw new BadRequestException('Bearer token responses are disabled')
    return result
  }
  setSessionCookies(res, result)
  return { user: result.user }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Brute-force protection: max 5 login attempts per minute per IP.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, clientCtx(req))
    if ('access_token' in result) return completeSession(req, res, result)
    return result
  }

  // Passwordless login: request a short-lived code by email. The response is
  // deliberately identical for known and unknown addresses.
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('email-code/request')
  requestEmailCode(@Body() dto: RequestEmailLoginCodeDto) {
    return this.auth.requestEmailLoginCode(dto)
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('email-code/verify')
  async verifyEmailCode(
    @Body() dto: VerifyEmailLoginCodeDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyEmailLoginCode(dto, clientCtx(req))
    if ('access_token' in result) return completeSession(req, res, result)
    return result
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const raw = dto.refresh_token || readCookie(req, REFRESH_COOKIE)
    if (!raw) throw new UnauthorizedException('Refresh token required')
    const result = await this.auth.refresh(raw, clientCtx(req))
    return completeSession(req, res, result)
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Body() dto: LogoutDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const user = req.user as JwtPayload
    const result = await this.auth.logout(dto.refresh_token || readCookie(req, REFRESH_COOKIE), user.sub)
    clearSessionCookies(res)
    return result
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const user = req.user as JwtPayload
    const result = await this.auth.logout(undefined, user.sub, true)
    clearSessionCookies(res)
    return result
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me((req.user as JwtPayload).sub)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@Body() dto: UpdateProfileDto, @Req() req: any) {
    return this.auth.updateProfile((req.user as JwtPayload).sub, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword((req.user as JwtPayload).sub, dto)
  }

  // Password reset (public, throttled to curb abuse/enumeration).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto)
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto)
  }

  // Invite a teammate (admins / users with settings.write).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.write')
  @Post('invitations')
  invite(@Body() dto: InviteDto, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.auth.invite(dto, user.organizationId, user.sub)
  }

  // Accept an invitation and set a password (public — token is the credential).
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.acceptInvite(dto, clientCtx(req))
    return completeSession(req, res, result)
  }

  // ── Two-factor authentication ────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  twoFactorSetup(@Req() req: any) {
    return this.auth.startTwoFactorSetup((req.user as JwtPayload).sub)
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  twoFactorEnable(@Body() dto: TwoFactorEnableDto, @Req() req: any) {
    return this.auth.enableTwoFactor((req.user as JwtPayload).sub, dto.code)
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  twoFactorDisable(@Body() dto: TwoFactorDisableDto, @Req() req: any) {
    return this.auth.disableTwoFactor((req.user as JwtPayload).sub, dto.code)
  }

  // Exchange a login 2FA challenge for real tokens (public — challenge is the credential).
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('2fa/verify')
  async twoFactorVerify(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyTwoFactor(dto.challenge, dto.code, clientCtx(req))
    return completeSession(req, res, result)
  }

  // ── SSO (OIDC) ───────────────────────────────────────────────────────────
  // Returns the IdP authorize URL for an org's login page to redirect to.
  @Get('sso/:slug/authorize')
  ssoAuthorize(@Param('slug') slug: string, @Query('next') next?: string) {
    return this.auth.ssoAuthorizeUrl(slug, next)
  }

  // IdP redirects the browser back here; we mint tokens then bounce to the app.
  @Get('sso/callback')
  async ssoCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    try {
      const { exchangeCode, redirectPath } = await this.auth.ssoCallback(code, state, clientCtx(req))
      const base = process.env.APP_URL || 'http://localhost:3000'
      const params = new URLSearchParams({ code: exchangeCode, next: redirectPath })
      return res.redirect(`${base.replace(/\/$/, '')}/login/sso-callback?${params.toString()}`)
    } catch {
      const base = process.env.APP_URL || 'http://localhost:3000'
      return res.redirect(`${base.replace(/\/$/, '')}/login?ssoError=sso_failed`)
    }
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('sso/exchange')
  async ssoExchange(
    @Body() dto: SsoExchangeDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.exchangeSsoLogin(dto.code, clientCtx(req))
    return completeSession(req, res, result)
  }

  // ── Account deletion (GDPR / right to erasure) ──────────────────────────
  // Anonymizes all PII and revokes every active session.
  // Rate-limited tightly to prevent accidental mass deletion or abuse.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Delete('me')
  deleteAccount(@Body() dto: DeleteAccountDto, @Req() req: any) {
    return this.auth.deleteAccount((req.user as JwtPayload).sub, dto.currentPassword)
  }
}
