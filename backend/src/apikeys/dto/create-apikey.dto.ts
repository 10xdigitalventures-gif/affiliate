import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export const VALID_SCOPES = ['orders.write', 'orders.read', 'stores.write', 'affiliates.read', 'reports.read'] as const
export type ApiKeyScope = typeof VALID_SCOPES[number]

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Custom Checkout', maxLength: 80, description: 'Human-friendly label for the key' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'API key name cannot be blank' })
  name!: string

  @ApiPropertyOptional({
    isArray: true,
    enum: VALID_SCOPES,
    example: ['orders.write'],
    description: 'Scopes granted to this key. Defaults to ["orders.write"].',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(VALID_SCOPES.length)
  @IsIn(VALID_SCOPES, { each: true })
  scopes?: ApiKeyScope[]
}
