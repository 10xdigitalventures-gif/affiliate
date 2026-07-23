import { IsIn, IsOptional, IsString, Matches } from 'class-validator'

export type DomainPurpose = 'login' | 'tracking'

export class AddDomainDto {
  @IsString()
  @Matches(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i, {
    message: 'hostname must be a valid domain, e.g. affiliates.yourbrand.com',
  })
  hostname!: string

  /** 'login' = white-label portal domain, 'tracking' = first-party click domain. */
  @IsOptional() @IsIn(['login', 'tracking'])
  purpose?: DomainPurpose
}
