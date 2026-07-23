import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator'

export class SubAffiliateSettingsDto {
  @IsBoolean()
  subAffiliateEnabled!: boolean

  /** % of the direct commission paid up each tier. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  subAffiliateRate?: number

  /** How many tiers up to reward (1 = only the direct recruiter). */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  subAffiliateMaxDepth?: number

  /** Rate multiplier applied per tier up (1 = flat, 0.5 = halve each level). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  subAffiliateDecay?: number
}
