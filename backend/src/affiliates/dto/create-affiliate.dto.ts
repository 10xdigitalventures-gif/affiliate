import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export const AFFILIATE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/
export const REFERRAL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export class CreateAffiliateDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @MinLength(2)
  @MaxLength(64)
  @Matches(AFFILIATE_CODE_PATTERN, {
    message: 'affiliateCode may contain only letters, numbers, underscores and hyphens',
  })
  affiliateCode?: string

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @MaxLength(64)
  @Matches(REFERRAL_SLUG_PATTERN, {
    message: 'referralSlug must contain only lowercase letters, numbers and hyphens',
  })
  referralSlug?: string
}
