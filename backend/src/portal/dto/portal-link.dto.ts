import { IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator'

export class CreatePortalLinkDto {
  @IsUrl({ require_tld: false })
  @Matches(/^https:\/\//i, { message: 'destinationUrl must use HTTPS' })
  @MaxLength(2048)
  destinationUrl!: string

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{3,20}$/, { message: 'shortCode must be 3-20 chars: letters, numbers, - or _' })
  shortCode?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmMedium?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  utmCampaign?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  utmContent?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  utmTerm?: string
}
