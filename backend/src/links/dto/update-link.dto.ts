import { IsOptional, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator'

export class UpdateLinkDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Matches(/^https?:\/\//i, { message: 'destinationUrl must use HTTP or HTTPS' })
  @MaxLength(2048)
  destinationUrl?: string

  // Empty string / null detaches the store or campaign.
  @IsOptional()
  @IsUUID()
  storeId?: string | null

  @IsOptional()
  @IsUUID()
  campaignId?: string | null
}
