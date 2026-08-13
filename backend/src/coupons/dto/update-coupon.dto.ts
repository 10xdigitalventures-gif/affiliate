import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator'

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  code?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'

  @IsOptional()
  @IsIn(['active', 'expired', 'disabled'])
  status?: 'active' | 'expired' | 'disabled'

  // Empty string / null clears the assignment.
  @IsOptional()
  @IsString()
  affiliateId?: string | null

  // ISO date; null clears the expiry.
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null
}
