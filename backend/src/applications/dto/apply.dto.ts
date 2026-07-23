import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'

export class ApplyDto {
  @IsEmail()
  email!: string

  @IsString()
  @MaxLength(80)
  firstName!: string

  @IsString()
  @MaxLength(80)
  lastName!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string
}
