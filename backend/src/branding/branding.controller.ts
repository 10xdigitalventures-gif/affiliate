import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { FeatureGuard } from '../entitlements/feature.guard'
import { RequireFeature } from '../entitlements/require-feature.decorator'
import { BrandingService } from './branding.service'
import { UpdateBrandingDto } from './dto/branding.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Current org branding (any authenticated user, so the UI can theme itself). */
  @Get()
  @UseGuards(JwtAuthGuard)
  get(@Req() req: { user: JwtPayload }) {
    return this.branding.getForOrg(req.user.organizationId)
  }

  /** Update branding — requires the branding feature + settings.write permission. */
  @Patch()
  @UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
  @RequirePermissions('settings.write')
  @RequireFeature('branding')
  update(@Req() req: { user: JwtPayload }, @Body() dto: UpdateBrandingDto) {
    return this.branding.update(req.user.organizationId, dto)
  }
}

/** Public, unauthenticated branding resolution for the branded login page. */
@Controller('public/branding')
export class PublicBrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  resolve(@Query('hostname') hostname?: string, @Query('slug') slug?: string) {
    return this.branding.resolvePublic({ hostname, slug })
  }
}
