import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator'

/**
 * Source-based commission rates. When enabled, a conversion made with the
 * affiliate's COUPON/PROMO CODE pays a different rate depending on whether the
 * customer arrived from a PAID ad we ran vs ORGANIC. Referral-LINK conversions
 * keep the normal rule-engine rate unless linkPaid/linkOrganic are also set.
 */
export class CommissionChannelSettingsDto {
  @IsBoolean()
  enabled!: boolean

  /** Code conversion, customer came organically. e.g. 10 (%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  codeOrganicRate?: number

  /** Code conversion, customer came from a paid ad we ran. e.g. 5 (%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  codePaidRate?: number

  /** Optional: override link conversions from organic traffic. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  linkOrganicRate?: number

  /** Optional: override link conversions from paid traffic. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  linkPaidRate?: number
}
