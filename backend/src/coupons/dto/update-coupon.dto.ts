import { Transform } from 'class-transformer'
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'
import { COUPON_CODE_PATTERN } from './create-coupon.dto'

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @MaxLength(64)
  @Matches(COUPON_CODE_PATTERN, { message: 'Coupon code may contain only letters, numbers, underscores and hyphens' })
  code?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'

  @IsOptional()
  @IsIn(['active', 'expired', 'disabled'])
  status?: 'active' | 'expired' | 'disabled'

  // Empty string / null clears the assignment.
  @IsOptional()
  @IsUUID('4')
  affiliateId?: string | null

  // ISO date; null clears the expiry.
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null
}
