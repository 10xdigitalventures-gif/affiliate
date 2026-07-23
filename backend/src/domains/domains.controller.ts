import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { FeatureGuard } from '../entitlements/feature.guard'
import { RequireFeature } from '../entitlements/require-feature.decorator'
import { DomainsService } from './domains.service'
import { AddDomainDto } from './dto/domain.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('domains')
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequirePermissions('settings.write')
@RequireFeature('customDomain')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  list(@Req() req: { user: JwtPayload }) {
    return this.domains.list(req.user.organizationId)
  }

  /** Effective first-party tracking base URL (custom tracking domain or platform default). */
  @Get('tracking-base')
  async trackingBase(@Req() req: { user: JwtPayload }) {
    const custom = await this.domains.trackingBaseUrl(req.user.organizationId)
    const fallback = (process.env.TRACKING_BASE_URL || process.env.API_PUBLIC_URL || 'https://affiliate.mentoringhub.online/v1').replace(/\/$/, '')
    return { baseUrl: custom ?? fallback, custom: !!custom, organizationId: req.user.organizationId }
  }

  @Post()
  add(@Req() req: { user: JwtPayload }, @Body() dto: AddDomainDto) {
    return this.domains.add(req.user.organizationId, dto)
  }

  @Post(':id/verify')
  verify(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.domains.verify(req.user.organizationId, id)
  }

  @Post(':id/primary')
  setPrimary(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.domains.setPrimary(req.user.organizationId, id)
  }

  @Delete(':id')
  remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.domains.remove(req.user.organizationId, id)
  }
}
