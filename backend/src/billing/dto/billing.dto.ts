import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'

export type ProviderName = 'whop' | 'swich'
const PROVIDERS: ProviderName[] = ['whop', 'swich']

/** Create or update a gateway config (platform-level, or tenant-scoped later). */
export class UpsertGatewayConfigDto {
  @IsIn(PROVIDERS)
  provider!: ProviderName

  @IsOptional() @IsIn(['platform', 'tenant'])
  scope?: 'platform' | 'tenant'

  @IsOptional() @IsString()
  organizationId?: string

  @IsOptional() @IsString()
  label?: string

  @IsOptional() @IsString()
  companyId?: string

  /** Plaintext secrets; encrypted at rest. Omit on update to keep existing. */
  @IsOptional() @IsString()
  apiKey?: string

  @IsOptional() @IsString()
  webhookSecret?: string

  @IsOptional() @IsBoolean()
  isLive?: boolean

  @IsOptional() @IsBoolean()
  isActive?: boolean

  @IsOptional() @IsBoolean()
  isDefault?: boolean

  // Tax passed on to the client on top of the plan price.
  @IsOptional() @IsBoolean()
  taxEnabled?: boolean

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  taxPercent?: number

  @IsOptional() @IsString()
  taxLabel?: string

  @IsOptional() @IsBoolean()
  taxInclusive?: boolean
}

/** Begin a save-card / setup flow for a tenant. */
export class StartSetupDto {
  @IsOptional() @IsString()
  configId?: string

  @IsOptional() @IsIn(PROVIDERS)
  provider?: ProviderName

  @IsOptional() @IsString()
  returnUrl?: string
}

/** Charge a tenant's saved card off-session. */
export class ChargeTenantDto {
  @IsInt() @Min(1)
  amountCents!: number

  @IsOptional() @IsString()
  currency?: string

  @IsOptional() @IsString()
  description?: string

  @IsOptional() @IsBoolean()
  recurring?: boolean

  @IsOptional() @IsBoolean()
  autoCharge?: boolean
}

/** Start a subscription for a tenant on a plan, applying the plan's trial. */
export class StartSubscriptionDto {
  @IsString()
  planId!: string

  @IsOptional() @IsInt() @Min(0)
  trialDaysOverride?: number

  @IsOptional() @IsString()
  configId?: string

  @IsOptional() @IsString()
  returnUrl?: string
}

/** Send a payout / disbursement through a gateway that supports it. */
export class CreatePayoutDto {
  @IsString()
  configId!: string

  @IsInt() @Min(1)
  amountCents!: number

  @IsOptional() @IsString()
  currency?: string

  @IsObject()
  destination!: Record<string, unknown>

  @IsOptional() @IsString()
  reference?: string

  @IsOptional() @IsString()
  purpose?: string
}
