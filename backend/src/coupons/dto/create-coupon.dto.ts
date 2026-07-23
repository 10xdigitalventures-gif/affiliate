import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/

export class CreateCouponDto {
  @IsUUID('4')
  storeId!: string

  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @MaxLength(64)
  @Matches(COUPON_CODE_PATTERN, { message: 'Coupon code may contain only letters, numbers, underscores and hyphens' })
  code!: string

  @IsOptional()
  @IsUUID('4')
  affiliateId?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'
}
