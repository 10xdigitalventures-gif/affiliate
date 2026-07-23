import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class SignupSettingsDto {
  @IsBoolean()
  signupEnabled!: boolean

  @IsBoolean()
  autoApprove!: boolean

  @IsOptional()
  @IsBoolean()
  requireWebsite?: boolean

  @IsOptional()
  @IsBoolean()
  allowAffiliateLinkCreation?: boolean

  // ---- Public sign-up page branding / customization ----
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subheadline?: string

  @IsOptional()
  @IsString()
  @MaxLength(600)
  imageUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(9)
  accentColor?: string

  @IsOptional()
  @IsIn(['split', 'centered'])
  layout?: 'split' | 'centered'

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buttonText?: string

  // ---- Embed (iframe) branding — independent design for the embeddable form ----
  // When embedCustom is false/undefined the embed inherits the hosted-page branding.
  @IsOptional()
  @IsBoolean()
  embedCustom?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(120)
  embedHeadline?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  embedSubheadline?: string

  @IsOptional()
  @IsString()
  @MaxLength(600)
  embedImageUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(9)
  embedAccentColor?: string

  @IsOptional()
  @IsIn(['split', 'centered'])
  embedLayout?: 'split' | 'centered'

  @IsOptional()
  @IsString()
  @MaxLength(40)
  embedButtonText?: string
}
