import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export const RULE_SCOPES = ['global', 'store', 'category', 'product', 'campaign', 'affiliate'] as const
export const COMMISSION_TYPES = ['percentage', 'fixed', 'tiered', 'recurring'] as const

export class CreateCommissionRuleDto {
  @IsIn(RULE_SCOPES as unknown as string[])
  scope!: (typeof RULE_SCOPES)[number]

  /** Required for every scope except `global`. e.g. productId / categoryId / storeId / affiliateId. */
  @IsOptional()
  @IsString()
  scopeRefId?: string

  @IsIn(COMMISSION_TYPES as unknown as string[])
  type!: (typeof COMMISSION_TYPES)[number]

  @IsNumber()
  @Min(0)
  value!: number

  @IsOptional()
  @IsInt()
  priority?: number

  @IsOptional()
  @IsBoolean()
  stackable?: boolean
}
