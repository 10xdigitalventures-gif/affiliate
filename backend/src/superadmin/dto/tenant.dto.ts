import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator'

export class CreateTenantDto {
  @IsString()
  @Length(2, 100)
  name!: string

  @IsString()
  @Matches(/^[a-z0-9-]{2,50}$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug!: string

  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string

  @IsOptional()
  @IsString()
  @Length(2, 100)
  ownerName?: string

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'ownerPassword needs upper/lowercase letters, a number and a symbol',
  })
  ownerPassword?: string

  @IsOptional()
  @IsBoolean()
  sendLoginCode?: boolean

  @IsOptional()
  @IsUUID()
  planId?: string

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'defaultCurrency must be a 3-letter ISO code' })
  defaultCurrency?: string

  @IsOptional()
  @IsIn(['active', 'trial'])
  status?: 'active' | 'trial'
}
