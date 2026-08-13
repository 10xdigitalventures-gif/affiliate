import { IsNumber, Min } from 'class-validator'

export class RefundOrderDto {
  @IsNumber()
  @Min(0)
  refundAmount!: number
}
