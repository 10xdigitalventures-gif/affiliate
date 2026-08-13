import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export const VALID_SCOPES = ['orders.write', 'orders.read', 'affiliates.read', 'reports.read'] as const
export type ApiKeyScope = typeof VALID_SCOPES[number]

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Custom Checkout', maxLength: 80, description: 'Human-friendly label for the key' })
  @IsString()
  @MaxLength(80)
  name!: string

  @ApiPropertyOptional({
    isArray: true,
    enum: VALID_SCOPES,
    example: ['orders.write'],
    description: 'Scopes granted to this key. Defaults to ["orders.write"].',
  })
  @IsOptional()
  @IsArray()
  scopes?: ApiKeyScope[]
}
