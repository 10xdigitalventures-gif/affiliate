import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,50}$/)
  workspace?: string
}
