import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator'

export class TaxSettingsDto {
  @IsBoolean()
  required!: boolean

  @IsOptional()
  @IsNumber()
  @Min(0)
  threshold?: number
}
