import { IsOptional, IsString } from 'class-validator'

export class CreateAffiliateDto {
  @IsOptional()
  @IsString()
  affiliateCode?: string

  @IsOptional()
  @IsString()
  referralSlug?: string
}
