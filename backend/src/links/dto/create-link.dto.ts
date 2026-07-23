import { IsOptional, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator'

export class CreateLinkDto {
  @IsUUID()
  affiliateId!: string

  @IsUrl({ require_tld: false })
  @Matches(/^https?:\/\//i, { message: 'destinationUrl must use HTTP or HTTPS' })
  @MaxLength(2048)
  destinationUrl!: string

  @IsOptional()
  @IsUUID()
  storeId?: string

  @IsOptional()
  @IsUUID()
  campaignId?: string

  // Optional custom vanity code (3-20 chars: letters, numbers, - or _).
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{3,20}$/, { message: 'shortCode must be 3-20 chars: letters, numbers, - or _' })
  shortCode?: string
}
