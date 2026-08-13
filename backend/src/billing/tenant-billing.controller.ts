import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { JwtPayload } from '../auth/jwt.strategy'
import { BillingService } from './billing.service'
import { CreatePayoutDto, UpsertGatewayConfigDto } from './dto/billing.dto'

/**
 * Tenant-facing payment gateways. A merchant configures and uses their OWN
 * Whop / Swich accounts (scope = 'tenant'), fully isolated from the platform's
 * gateways. Primary use today: paying affiliate payouts through Swich.
 *
 * All routes are hard-scoped to req.user.organizationId, so a tenant can never
 * see or touch another tenant's (or the platform's) gateways.
 */
@Controller('tenant-billing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantBillingController {
  constructor(private readonly svc: BillingService) {}

  @Get('config')
  @RequirePermissions('billing.read')
  list(@Req() req: { user: JwtPayload }) {
    return this.svc.listTenantConfigs(req.user.organizationId)
  }

  @Post('config')
  @RequirePermissions('billing.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: UpsertGatewayConfigDto) {
    return this.svc.createTenantConfig(req.user.organizationId, dto)
  }

  @Get('config/:id')
  @RequirePermissions('billing.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.getTenantConfig(req.user.organizationId, id)
  }

  @Patch('config/:id')
  @RequirePermissions('billing.write')
  update(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: UpsertGatewayConfigDto) {
    return this.svc.updateTenantConfig(req.user.organizationId, id, dto)
  }

  @Delete('config/:id')
  @RequirePermissions('billing.write')
  remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.deleteTenantConfig(req.user.organizationId, id)
  }

  /** Send an affiliate payout through the tenant's own gateway (e.g. Swich). */
  @Post('payouts')
  @RequirePermissions('billing.write')
  payout(@Req() req: { user: JwtPayload }, @Body() dto: CreatePayoutDto) {
    return this.svc.createTenantPayout(req.user.organizationId, dto)
  }
}
