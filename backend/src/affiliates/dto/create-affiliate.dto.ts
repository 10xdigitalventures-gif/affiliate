import { IsOptional, IsString, Matches } from 'class-validator'
import { Transform } from 'class-transformer'

const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_-]+$/

export class CreateAffiliateDto {
  @IsOptional()
  @IsString()
  @Matches(SAFE_IDENTIFIER_RE, { message: 'affiliateCode may only contain letters, digits, underscores and hyphens' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  affiliateCode?: string

  @IsOptional()
  @IsString()
  @Matches(SAFE_IDENTIFIER_RE, { message: 'referralSlug may only contain letters, digits, underscores and hyphens' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  referralSlug?: string
}
