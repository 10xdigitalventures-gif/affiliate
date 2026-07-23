import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator'

/**
 * New-vs-returning customer commission rates. When enabled, a conversion pays a
 * different percentage of the order subtotal depending on whether the buyer is
 * a first-time customer or a repeat customer. Takes precedence over the
 * source-based (paid/organic) rate and the rule engine when it applies.
 */
export class CustomerTypeSettingsDto {
  @IsBoolean()
  enabled!: boolean

  /** Rate for a customer's FIRST purchase. e.g. 15 (%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  newCustomerRate?: number

  /** Rate for repeat customers. e.g. 5 (%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  returningCustomerRate?: number
}
