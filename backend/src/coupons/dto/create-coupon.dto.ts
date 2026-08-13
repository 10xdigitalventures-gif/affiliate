import { IsIn, IsOptional, IsString } from 'class-validator'

export class CreateCouponDto {
  @IsString()
  storeId!: string

  @IsString()
  code!: string

  @IsOptional()
  @IsString()
  affiliateId?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'
}
