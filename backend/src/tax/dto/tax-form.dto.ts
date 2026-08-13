import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

/**
 * Affiliate-submitted tax form. W-9 for US persons, W-8BEN for foreign persons.
 * The raw TIN is encrypted at rest (AES-256-GCM) and never returned to clients.
 */
export class TaxFormDto {
  @IsIn(['w9', 'w8ben'])
  formType!: 'w9' | 'w8ben'

  @IsString()
  @MinLength(2)
  legalName!: string

  @IsOptional()
  @IsString()
  businessName?: string

  // W-9 federal tax classification (individual/sole_prop, c_corp, s_corp, partnership, trust, llc)
  @IsOptional()
  @IsString()
  taxClassification?: string

  @IsOptional()
  @IsIn(['ssn', 'ein'])
  tinType?: 'ssn' | 'ein'

  @IsString()
  @MinLength(4)
  tin!: string

  @IsString()
  country!: string

  @IsString()
  address1!: string

  @IsOptional()
  @IsString()
  address2?: string

  @IsString()
  city!: string

  @IsOptional()
  @IsString()
  state?: string

  @IsOptional()
  @IsString()
  postalCode?: string

  // Typed signature acknowledging the perjury certification.
  @IsString()
  @MinLength(2)
  signature!: string

  @IsBoolean()
  certify!: boolean
}
