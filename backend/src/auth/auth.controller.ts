import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  InviteDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  SelectWorkspaceDto,
  TwoFactorEnableDto,
  TwoFactorDisableDto,
  TwoFactorVerifyDto,
} from './dto/auth.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard, RequirePermissions } from '../common/guards/permissions.guard'
import { JwtPayload } from './jwt.strategy'

function clientCtx(req: any) {
  return {
    userAgent: req.headers?.['user-agent'],
    ipAddress: (req.headers?.['x-forwarded-for']?.split(',')[0] || req.ip || '').trim() || undefined,
    // Used to resolve the tenant for unauthenticated requests. `trust proxy` is
    // enabled in main.ts, so x-forwarded-host is the client-facing hostname.
    hostname: req.headers?.['x-forwarded-host'] || req.headers?.host || undefined,
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Brute-force protection: max 5 login attempts per minute per IP.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, clientCtx(req))
  }

  // Second step when one address unlocks accounts in several workspaces.
  // The challenge is only issued after the password has already been verified.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('select-workspace')
  selectWorkspace(@Body() dto: SelectWorkspaceDto, @Req() req: any) {
    return this.auth.selectWorkspace(dto.challenge, dto.orgSlug, clientCtx(req))
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refresh_token, clientCtx(req))
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Body() dto: LogoutDto, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.auth.logout(dto.refresh_token, user.sub)
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  logoutAll(@Req() req: any) {
    const user = req.user as JwtPayload
    return this.auth.logout(undefined, user.sub, true)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me((req.user as JwtPayload).sub)
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword((req.user as JwtPayload).sub, dto)
  }

  // Password reset (public, throttled to curb abuse/enumeration).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    return this.auth.forgotPassword(dto, clientCtx(req))
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
  acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: any) {
    return this.auth.acceptInvite(dto, clientCtx(req))
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
  twoFactorVerify(@Body() dto: TwoFactorVerifyDto, @Req() req: any) {
    return this.auth.verifyTwoFactor(dto.challenge, dto.code, clientCtx(req))
  }

  // ── SSO (OIDC) ───────────────────────────────────────────────────────────
  // Returns the IdP authorize URL for an org's login page to redirect to.
  @Get('sso/:slug/authorize')
  ssoAuthorize(@Param('slug') slug: string, @Query('redirectUri') redirectUri?: string) {
    return this.auth.ssoAuthorizeUrl(slug, redirectUri)
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
      const { tokens, redirectUri } = await this.auth.ssoCallback(code, state, clientCtx(req))
      const frag = new URLSearchParams({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      }).toString()
      return res.redirect(`${redirectUri.replace(/\/$/, '')}/login/sso-callback#${frag}`)
    } catch (err) {
      const base = process.env.APP_URL || 'http://localhost:3000'
      const msg = encodeURIComponent((err as Error).message || 'SSO sign-in failed')
      return res.redirect(`${base}/login?ssoError=${msg}`)
    }
  }

  // ── Account deletion (GDPR / right to erasure) ──────────────────────────
  // Anonymizes all PII and revokes every active session.
  // Rate-limited tightly to prevent accidental mass deletion or abuse.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Delete('me')
  deleteAccount(@Req() req: any) {
    return this.auth.deleteAccount((req.user as JwtPayload).sub)
  }
}
