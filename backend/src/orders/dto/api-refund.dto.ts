import { IsNumber, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'

/**
 * Refund payload for the machine-to-machine refund endpoint
 * (POST /v1/orders/refund/apikey). Identifies the order by its external id so
 * plugins/custom stores don't need our internal order id.
 */
export class ApiRefundDto {
  @IsUUID()
  storeId!: string

  @IsString()
  @MaxLength(255)
  externalOrderId!: string

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  refundAmount!: number
}
