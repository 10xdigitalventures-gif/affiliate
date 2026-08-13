import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class IngestOrderDto {
  @IsString()
  storeId!: string

  @IsString()
  externalOrderId!: string

  // Rule 5 hardening: reject negative order values so a compromised/buggy
  // orders.write caller cannot mint negative commissions or corrupt totals.
  @IsNumber()
  @Min(0)
  subtotal!: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  placedAt?: string

  @IsOptional()
  @IsString()
  customerId?: string

  @IsOptional()
  @IsString()
  customerEmail?: string

  // Attribution signals
  @IsOptional()
  @IsString()
  couponCode?: string

  @IsOptional()
  @IsString()
  referralCode?: string // value of the aff_ref cookie at checkout

  // Traffic channel signals (from aff_channel cookie captured on landing).
  @IsOptional()
  @IsIn(['paid', 'organic'])
  channel?: 'paid' | 'organic'

  @IsOptional()
  @IsString()
  adNetwork?: string

  // Optional explicit hint: 'link' (referral link) | 'code' (promo/referral code).
  @IsOptional()
  @IsIn(['link', 'code'])
  attributionType?: 'link' | 'code'

  // ---- UTM / ad-source signals (carried from the landing page to the order) ----
  @IsOptional()
  @IsString()
  clickId?: string // aff_click cookie / click id, used to backfill source from the recorded click

  @IsOptional()
  @IsString()
  adClickId?: string // gclid / fbclid / ttclid etc.

  @IsOptional()
  @IsString()
  utmSource?: string

  @IsOptional()
  @IsString()
  utmMedium?: string

  @IsOptional()
  @IsString()
  utmCampaign?: string

  @IsOptional()
  @IsString()
  utmContent?: string

  @IsOptional()
  @IsString()
  utmTerm?: string

  @IsOptional()
  @IsString()
  landingSite?: string // first landing URL (Shopify landing_site), full query string

  @IsOptional()
  @IsString()
  referrer?: string // external referring site
}
