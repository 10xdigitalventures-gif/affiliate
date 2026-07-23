import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'

export class UpsertProductDto {
  @IsUUID()
  storeId!: string

  @IsString()
  @MaxLength(255)
  externalId!: string

  @IsString()
  @MaxLength(500)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sku?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  categoryName?: string

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  price!: number

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'
}
