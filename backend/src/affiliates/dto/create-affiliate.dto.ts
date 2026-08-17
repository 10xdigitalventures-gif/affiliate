import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class CreateAffiliateDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z0-9_]+$/)
  affiliateCode?: string

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  referralSlug?: string
}
