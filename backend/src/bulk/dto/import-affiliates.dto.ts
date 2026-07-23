import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class ImportAffiliatesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000_000)
  csv!: string
}
