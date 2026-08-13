import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(6)
  password!: string

  /**
   * Workspace to sign in to. Optional: when the request arrives on a tenant
   * login domain or subdomain the tenant is resolved from the Host header
   * instead. If neither is present and the email exists in more than one
   * workspace, the API answers with a workspace-selection challenge.
   */
  @IsOptional()
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'orgSlug must be a lowercase workspace slug' })
  orgSlug?: string
}
