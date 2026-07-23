import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'

export class BulkGenerateCouponsDto {
  @IsUUID('4')
  storeId!: string

  @IsInt()
  @Min(1)
  @Max(500)
  count!: number

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]*$/, { message: 'Coupon prefix may contain only letters, numbers, underscores and hyphens' })
  prefix?: string

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(12)
  length?: number

  @IsOptional()
  @IsUUID('4')
  affiliateId?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'
}
