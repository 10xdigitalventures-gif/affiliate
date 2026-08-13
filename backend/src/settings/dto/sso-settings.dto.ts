import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

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
  provider?: string

  @IsOptional()
  @IsString()
  clientId?: string

  @IsOptional()
  @IsString()
  clientSecret?: string

  @IsOptional()
  @IsString()
  authorizationUrl?: string

  @IsOptional()
  @IsString()
  tokenUrl?: string

  @IsOptional()
  @IsString()
  userinfoUrl?: string

  @IsOptional()
  @IsString()
  scopes?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[]

  @IsOptional()
  @IsBoolean()
  autoProvision?: boolean

  @IsOptional()
  @IsString()
  defaultRoleId?: string
}
