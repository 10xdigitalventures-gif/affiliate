import { IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator'
import { PayoutMethod } from '@prisma/client'

export class RequestPortalPayoutDto {
  @IsEnum(PayoutMethod)
  method!: PayoutMethod

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string
}

export class AddPortalPayoutMethodDto {
  @IsEnum(PayoutMethod)
  method!: PayoutMethod

  @IsObject()
  details!: Record<string, unknown>
}
