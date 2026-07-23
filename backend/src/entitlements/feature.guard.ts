import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { EntitlementsService } from './entitlements.service'
import { FEATURE_KEY } from './require-feature.decorator'
import type { FeatureKey } from './entitlements.constants'
import { JwtPayload } from '../auth/jwt.strategy'

/** Allows a request only if the caller's plan enables the required feature. Super admins bypass. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!feature) return true

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    if (!user) throw new ForbiddenException('Not authenticated')
    if (user.isSuperAdmin) return true

    await this.entitlements.assertFeature(user.organizationId, feature)
    return true
  }
}
