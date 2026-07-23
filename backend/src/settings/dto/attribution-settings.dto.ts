import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class CouponProtectionDto {
  @IsOptional()
  @IsIn(['off', 'flag', 'block'])
  mode?: 'off' | 'flag' | 'block'

  @IsOptional()
  @IsBoolean()
  requireClickSupport?: boolean

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedReferrers?: string[]
}

export class AttributionSettingsDto {
  @IsOptional()
  @IsIn(['last_click', 'first_click', 'linear', 'position'])
  cookieModel?: 'last_click' | 'first_click' | 'linear' | 'position'

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  cookieWindowDays?: number

  @IsOptional()
  @IsBoolean()
  couponPriority?: boolean

  @IsOptional()
  @IsBoolean()
  lifetimeEnabled?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => CouponProtectionDto)
  couponProtection?: CouponProtectionDto
}
