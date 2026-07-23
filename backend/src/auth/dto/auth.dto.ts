import { Equals, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator'

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/

export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string
}

export class SsoExchangeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  code!: string
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,50}$/)
  workspace?: string
}

export class RequestEmailLoginCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,50}$/)
  workspace?: string
}

export class VerifyEmailLoginCodeDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  challenge!: string

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(512)
  token!: string

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, { message: 'Password needs upper/lowercase letters, a number and a symbol' })
  password!: string
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, { message: 'Password needs upper/lowercase letters, a number and a symbol' })
  newPassword!: string
}

export class DeleteAccountDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string

  @IsString()
  @Equals('DELETE', { message: 'confirmation must be exactly DELETE' })
  confirmation!: string
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(90_000)
  @Matches(/^(https:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i, {
    message: 'Profile picture must be an HTTPS URL or a supported image',
  })
  avatarUrl?: string | null
}

export class InviteDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string

  @IsOptional()
  @IsUUID('4')
  roleId?: string
}

export class AcceptInviteDto {
  @IsString()
  @MaxLength(512)
  token!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, { message: 'Password needs upper/lowercase letters, a number and a symbol' })
  password!: string
}

// ── Two-factor authentication ──────────────────────────────────────────────
export class TwoFactorEnableDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Authentication code must contain six digits' })
  code!: string
}

export class TwoFactorDisableDto {
  @IsString()
  @MaxLength(32)
  code!: string
}

export class TwoFactorVerifyDto {
  @IsString()
  @MaxLength(2048)
  challenge!: string

  @IsString()
  @MaxLength(32)
  code!: string
}
