import { IsOptional, IsUUID } from 'class-validator'

export class SetAffiliateParentDto {
  @IsOptional()
  @IsUUID('4')
  parentAffiliateId?: string | null
}
