import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

export class CreateTeamRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissionKeys!: string[]
}

export class UpdateTeamRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissionKeys?: string[]
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  roleIds?: string[]

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended'
}
