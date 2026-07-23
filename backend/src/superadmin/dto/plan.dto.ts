import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator'

export class CreatePlanDto {
  @IsString()
  @Matches(/^[a-z0-9_-]{2,40}$/, { message: 'key must be lowercase slug (a-z, 0-9, _, -)' })
  key!: string

  @IsString()
  @Length(2, 100)
  name!: string

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string

  @IsInt()
  @Min(0)
  priceCents!: number

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string

  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year'

  @IsObject()
  features!: Record<string, boolean>

  @IsObject()
  limits!: Record<string, number>

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string

  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year'

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number
}

export class AssignPlanDto {
  @IsUUID()
  planId!: string

  @IsOptional()
  @IsIn(['active', 'trialing', 'past_due', 'canceled'])
  status?: 'active' | 'trialing' | 'past_due' | 'canceled'

  @IsOptional()
  @IsInt()
  @Min(0)
  seats?: number

  @IsOptional()
  @IsObject()
  overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> }
}

export class UpdateTenantStatusDto {
  @IsIn(['active', 'suspended', 'trial'])
  status!: 'active' | 'suspended' | 'trial'
}
