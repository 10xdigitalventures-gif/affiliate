import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { JwtPayload } from '../auth/jwt.strategy'

/** Allows only platform super admins (isSuperAdmin on the JWT). */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    if (!user) throw new ForbiddenException('Not authenticated')
    if (!user.isSuperAdmin) throw new ForbiddenException('Super admin access required')
    return true
  }
}
