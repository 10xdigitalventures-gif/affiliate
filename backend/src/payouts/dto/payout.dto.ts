import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'
import { PayoutMethod } from '@prisma/client'

export class CreatePayoutBatchDto {
  @IsUUID()
  affiliateId!: string

  @IsEnum(PayoutMethod)
  method!: PayoutMethod

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string

  @IsString()
  @IsOptional()
  @MaxLength(200)
  transactionReference?: string
}

export class MarkPaidDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  transactionReference?: string
}

export class FailDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string
}
