import { Transform } from 'class-transformer'
import { IsOptional, IsString, MaxLength } from 'class-validator'

export class TaxReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  note?: string
}
