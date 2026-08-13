import { IsOptional, IsString, IsUrl } from 'class-validator'

export class UpdateLinkDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  destinationUrl?: string

  // Empty string / null detaches the store or campaign.
  @IsOptional()
  @IsString()
  storeId?: string | null

  @IsOptional()
  @IsString()
  campaignId?: string | null
}
