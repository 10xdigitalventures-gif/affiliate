import { Transform } from 'class-transformer'
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator'

export class IngestOrderDto {
  @IsUUID()
  storeId!: string

  @IsString()
  @MaxLength(255)
  externalOrderId!: string

  // Rule 5 hardening: reject negative order values so a compromised/buggy
  // orders.write caller cannot mint negative commissions or corrupt totals.
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  subtotal!: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  total?: number

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^[A-Z]{3}$/)
  currency?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string

  @IsOptional()
  @IsDateString()
  placedAt?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerId?: string

  /** Stable customer id supplied by the connected commerce platform. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalCustomerId?: string

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  customerEmail?: string

  // Attribution signals
  @IsOptional()
  @IsString()
  @MaxLength(128)
  couponCode?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralCode?: string // value of the aff_ref cookie at checkout

  // Traffic channel signals (from aff_channel cookie captured on landing).
  @IsOptional()
  @IsIn(['paid', 'organic'])
  channel?: 'paid' | 'organic'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  adNetwork?: string

  // Optional explicit hint: 'link' (referral link) | 'code' (promo/referral code).
  @IsOptional()
  @IsIn(['link', 'code'])
  attributionType?: 'link' | 'code'

  // ---- UTM / ad-source signals (carried from the landing page to the order) ----
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clickId?: string // aff_click cookie / click id, used to backfill source from the recorded click

  @IsOptional()
  @IsString()
  @MaxLength(512)
  adClickId?: string // gclid / fbclid / ttclid etc.

  @IsOptional()
  @IsString()
  @MaxLength(512)
  utmSource?: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  utmMedium?: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  utmCampaign?: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  utmContent?: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  utmTerm?: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  landingSite?: string // first landing URL (Shopify landing_site), full query string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  referrer?: string // external referring site
}
