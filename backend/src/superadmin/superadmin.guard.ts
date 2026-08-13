import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { JwtPayload } from '../auth/jwt.strategy'

/**
 * Allows only platform super admins.
 *
 * `isSuperAdmin` is read back from the database by JwtStrategy on every
 * request, not taken from the JWT claims, so revoking the flag takes effect
 * without waiting for the token to expire.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    if (!user) throw new ForbiddenException('Not authenticated')
    if (!user.isSuperAdmin) throw new ForbiddenException('Super admin access required')
    return true
  }
}
