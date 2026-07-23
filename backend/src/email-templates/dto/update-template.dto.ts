import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateEmailTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string
}
