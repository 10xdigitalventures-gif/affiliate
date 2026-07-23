import { Transform } from 'class-transformer'
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

/** Browser click beacon payload. Unknown keys are rejected by the global pipe. */
export class TrackClickDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ref!: string

  @IsOptional()
  @Transform(trim)
  @IsUUID()
  org?: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  u?: string

  @IsOptional() @IsString() @MaxLength(512) utm_source?: string
  @IsOptional() @IsString() @MaxLength(512) utm_medium?: string
  @IsOptional() @IsString() @MaxLength(512) utm_campaign?: string
  @IsOptional() @IsString() @MaxLength(512) utm_term?: string
  @IsOptional() @IsString() @MaxLength(512) utm_content?: string

  @IsOptional() @IsString() @MaxLength(512) gclid?: string
  @IsOptional() @IsString() @MaxLength(512) gbraid?: string
  @IsOptional() @IsString() @MaxLength(512) wbraid?: string
  @IsOptional() @IsString() @MaxLength(512) gclsrc?: string
  @IsOptional() @IsString() @MaxLength(512) dclid?: string
  @IsOptional() @IsString() @MaxLength(512) fbclid?: string
  @IsOptional() @IsString() @MaxLength(512) ttclid?: string
  @IsOptional() @IsString() @MaxLength(512) msclkid?: string
  @IsOptional() @IsString() @MaxLength(512) li_fat_id?: string
  @IsOptional() @IsString() @MaxLength(512) twclid?: string
  @IsOptional() @IsString() @MaxLength(512) epik?: string
  @IsOptional() @IsString() @MaxLength(512) sccid?: string
}
