import { IsOptional, IsString, IsUrl, Matches } from 'class-validator'

export class CreateLinkDto {
  @IsString()
  affiliateId!: string

  @IsUrl({ require_tld: false })
  destinationUrl!: string

  @IsOptional()
  @IsString()
  storeId?: string

  @IsOptional()
  @IsString()
  campaignId?: string

  // Optional custom vanity code (3-20 chars: letters, numbers, - or _).
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{3,20}$/, { message: 'shortCode must be 3-20 chars: letters, numbers, - or _' })
  shortCode?: string
}
