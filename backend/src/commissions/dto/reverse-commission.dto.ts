import { IsString, MinLength } from 'class-validator'

export class ReverseCommissionDto {
  @IsString()
  @MinLength(3)
  reason!: string
}
