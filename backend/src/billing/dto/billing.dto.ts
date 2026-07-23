import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Matches,
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

  @IsOptional() @IsUUID()
  organizationId?: string

  @IsOptional() @IsString() @MaxLength(120)
  label?: string

  @IsOptional() @IsString() @MaxLength(200)
  companyId?: string

  /** Plaintext secrets; encrypted at rest. Omit on update to keep existing. */
  @IsOptional() @IsString() @MaxLength(4096)
  apiKey?: string

  @IsOptional() @IsString() @MaxLength(4096)
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

  @IsOptional() @IsString() @MaxLength(80)
  taxLabel?: string

  @IsOptional() @IsBoolean()
  taxInclusive?: boolean
}

/** Begin a save-card / setup flow for a tenant. */
export class StartSetupDto {
  @IsOptional() @IsUUID()
  configId?: string

  @IsOptional() @IsIn(PROVIDERS)
  provider?: ProviderName

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  returnUrl?: string
}

/** Charge a tenant's saved card off-session. */
export class ChargeTenantDto {
  @IsInt() @Min(1) @Max(1_000_000_000_00)
  amountCents!: number

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(3, 3) @Matches(/^[A-Z]{3}$/)
  currency?: string

  @IsOptional() @IsString() @MaxLength(500)
  description?: string

  @IsOptional() @IsBoolean()
  recurring?: boolean

  @IsOptional() @IsBoolean()
  autoCharge?: boolean
}

/** Start a subscription for a tenant on a plan, applying the plan's trial. */
export class StartSubscriptionDto {
  @IsUUID()
  planId!: string

  @IsOptional() @IsInt() @Min(0) @Max(365)
  trialDaysOverride?: number

  @IsOptional() @IsUUID()
  configId?: string

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  returnUrl?: string
}

/** Send a payout / disbursement through a gateway that supports it. */
export class CreatePayoutDto {
  @IsUUID()
  configId!: string

  @IsInt() @Min(1) @Max(1_000_000_000_00)
  amountCents!: number

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(3, 3) @Matches(/^[A-Z]{3}$/)
  currency?: string

  @IsObject()
  destination!: Record<string, unknown>

  @IsOptional() @IsString() @MaxLength(200)
  reference?: string

  @IsOptional() @IsString() @MaxLength(200)
  purpose?: string
}
