import { IsBoolean, IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyName?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  faviconUrl?: string

  @IsOptional()
  @IsHexColor()
  primaryColor?: string

  @IsOptional()
  @IsHexColor()
  accentColor?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  loginHeadline?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supportEmail?: string

  @IsOptional()
  @IsBoolean()
  hidePlatformBranding?: boolean
}
