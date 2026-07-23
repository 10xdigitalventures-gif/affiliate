import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator'

/**
 * Organization SSO (OIDC / OAuth2 authorization-code) configuration. Works with
 * Google Workspace, Okta, Azure AD, Auth0, etc. The client secret is write-only:
 * it is stored but never returned by the GET endpoint.
 */
export class SsoSettingsDto {
  @IsBoolean()
  enabled!: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientId?: string

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  clientSecret?: string

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(2_000)
  issuerUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  scopes?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  @Matches(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, {
    each: true,
    message: 'Each allowed domain must be a valid DNS domain',
  })
  allowedDomains?: string[]

  @IsOptional()
  @IsBoolean()
  autoProvision?: boolean

  @IsOptional()
  @IsUUID()
  defaultRoleId?: string
}
