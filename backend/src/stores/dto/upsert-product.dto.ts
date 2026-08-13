import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class UpsertProductDto {
  @IsString()
  storeId!: string

  @IsString()
  externalId!: string

  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  sku?: string

  @IsOptional()
  @IsString()
  categoryName?: string

  @IsNumber()
  @Min(0)
  price!: number

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'
}
