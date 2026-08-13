import { IsNumber, IsString, Min } from 'class-validator'

/**
 * Refund payload for the machine-to-machine refund endpoint
 * (POST /v1/orders/refund/apikey). Identifies the order by its external id so
 * plugins/custom stores don't need our internal order id.
 */
export class ApiRefundDto {
  @IsString()
  storeId!: string

  @IsString()
  externalOrderId!: string

  @IsNumber()
  @Min(0)
  refundAmount!: number
}
