import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthIdentity, IdentityService } from './identity.service'

/**
 * The claims we put into an access token.
 *
 * Only `sub` is trusted on the way back in. The rest are carried for debugging
 * and for clients that want to avoid an extra round trip - they are NOT used
 * for authorization. See `validate()`.
 */
export interface JwtPayload {
  sub: string
  organizationId: string
  permissions: string[]
  affiliateId?: string | null
  isSuperAdmin?: boolean
}

/** What actually lands on `req.user`. Recomputed from the database. */
export type RequestUser = AuthIdentity

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly identity: IdentityService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // No fallback — startup guard in main.ts ensures this is always a real secret.
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    })
  }

  /**
   * Previously this returned the decoded payload as-is, which meant every
   * authorization decision in the app trusted a snapshot taken at login time.
   * A suspended user, a revoked role, or a suspended organization stayed fully
   * effective until the token expired.
   *
   * Now the token supplies only the subject id and the identity is rebuilt from
   * the database on each request (behind a short TTL cache).
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (!payload?.sub) throw new UnauthorizedException('Invalid token')

    const identity = await this.identity.resolve(payload.sub)
    if (!identity) throw new UnauthorizedException('Account is no longer active')

    // A token whose organization no longer matches the user's record is either
    // stale or forged. Refuse it rather than silently switching tenants —
    // req.user.organizationId is what the Prisma tenant scoping keys off.
    if (payload.organizationId && payload.organizationId !== identity.organizationId) {
      throw new UnauthorizedException('Token does not match the account organization')
    }

    return identity
  }
}
