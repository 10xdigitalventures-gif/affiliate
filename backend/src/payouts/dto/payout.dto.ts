import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { PayoutMethod } from '@prisma/client'

export class CreatePayoutBatchDto {
  @IsUUID()
  affiliateId!: string

  @IsEnum(PayoutMethod)
  method!: PayoutMethod

  @IsString()
  @IsOptional()
  currency?: string

  @IsString()
  @IsOptional()
  transactionReference?: string
}

export class MarkPaidDto {
  @IsString()
  @IsOptional()
  transactionReference?: string
}

export class FailDto {
  @IsString()
  @IsOptional()
  reason?: string
}
