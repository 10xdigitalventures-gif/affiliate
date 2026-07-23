import { IsNumber, Max, Min } from 'class-validator'

export class RefundOrderDto {
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  refundAmount!: number
}
