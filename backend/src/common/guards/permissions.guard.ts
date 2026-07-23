import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSIONS_KEY } from './permissions.decorator'
export { RequirePermissions } from './permissions.decorator'
import { JwtPayload } from '../../auth/jwt.strategy'

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true
    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    if (!user) throw new ForbiddenException('Not authenticated')
    const ok = required.every((p) => user.permissions?.includes(p))
    if (!ok) throw new ForbiddenException('Missing required permission')
    return true
  }
}
