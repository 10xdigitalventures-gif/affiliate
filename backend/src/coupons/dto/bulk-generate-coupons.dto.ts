import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class BulkGenerateCouponsDto {
  @IsString()
  storeId!: string

  @IsInt()
  @Min(1)
  @Max(500)
  count!: number

  @IsOptional()
  @IsString()
  prefix?: string

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(12)
  length?: number

  @IsOptional()
  @IsString()
  affiliateId?: string

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  discountType?: 'percentage' | 'fixed'
}
