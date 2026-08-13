import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

/** Reusable validation for an optional tenant slug on a public endpoint. */
const SLUG_MATCH = /^[a-z0-9][a-z0-9-]*$/

export class RefreshDto {
  @IsString()
  refresh_token!: string
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refresh_token?: string
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string

  /**
   * Workspace the reset is for. Without it the tenant is taken from the Host
   * header; if that is also absent, a reset link is sent for every workspace
   * the address belongs to, each naming its workspace.
   */
  @IsOptional()
  @IsString()
  @MaxLength(63)
  @Matches(SLUG_MATCH, { message: 'orgSlug must be a lowercase workspace slug' })
  orgSlug?: string
}

/**
 * Second step of a login where the address exists in several workspaces.
 * The challenge is only issued after the password has already been verified.
 */
export class SelectWorkspaceDto {
  @IsString()
  challenge!: string

  @IsString()
  @MaxLength(63)
  @Matches(SLUG_MATCH, { message: 'orgSlug must be a lowercase workspace slug' })
  orgSlug!: string
}

export class ResetPasswordDto {
  @IsString()
  token!: string

  @IsString()
  @MinLength(8)
  password!: string
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string

  @IsString()
  @MinLength(8)
  newPassword!: string
}

export class InviteDto {
  @IsEmail()
  email!: string

  @IsOptional()
  @IsString()
  fullName?: string

  @IsOptional()
  @IsString()
  roleId?: string
}

export class AcceptInviteDto {
  @IsString()
  token!: string

  @IsOptional()
  @IsString()
  fullName?: string

  @IsString()
  @MinLength(8)
  password!: string
}

// ── Two-factor authentication ──────────────────────────────────────────────
export class TwoFactorEnableDto {
  @IsString()
  code!: string
}

export class TwoFactorDisableDto {
  @IsString()
  code!: string
}

export class TwoFactorVerifyDto {
  @IsString()
  challenge!: string

  @IsString()
  code!: string
}
