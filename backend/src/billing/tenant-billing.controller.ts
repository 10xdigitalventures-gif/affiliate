import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { JwtPayload } from '../auth/jwt.strategy'
import { BillingService } from './billing.service'
import { CreatePayoutDto, UpsertGatewayConfigDto } from './dto/billing.dto'
import { AuditService } from '../audit/audit.service'

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
  constructor(private readonly svc: BillingService, private readonly audit: AuditService) {}

  private record(actor: JwtPayload, action: string, resourceId?: string, newValue?: unknown) {
    return this.audit.log({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action,
      resourceType: 'PaymentGatewayConfig',
      resourceId,
      newValue,
    })
  }

  @Get('config')
  @RequirePermissions('billing.read')
  list(@Req() req: { user: JwtPayload }) {
    return this.svc.listTenantConfigs(req.user.organizationId)
  }

  @Post('config')
  @RequirePermissions('billing.write')
  async create(@Req() req: { user: JwtPayload }, @Body() dto: UpsertGatewayConfigDto) {
    const result = await this.svc.createTenantConfig(req.user.organizationId, dto)
    await this.record(req.user, 'billing.gateway_created', result.id, { provider: result.provider })
    return result
  }

  @Get('config/:id')
  @RequirePermissions('billing.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.getTenantConfig(req.user.organizationId, id)
  }

  @Patch('config/:id')
  @RequirePermissions('billing.write')
  async update(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: UpsertGatewayConfigDto) {
    const result = await this.svc.updateTenantConfig(req.user.organizationId, id, dto)
    await this.record(req.user, 'billing.gateway_updated', id, {
      provider: result.provider, isActive: result.isActive, isLive: result.isLive, isDefault: result.isDefault,
    })
    return result
  }

  @Delete('config/:id')
  @RequirePermissions('billing.write')
  async remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    const result = await this.svc.deleteTenantConfig(req.user.organizationId, id)
    await this.record(req.user, 'billing.gateway_deleted', id)
    return result
  }

  /** Send an affiliate payout through the tenant's own gateway (e.g. Swich). */
  @Post('payouts')
  @RequirePermissions('billing.write')
  async payout(@Req() req: { user: JwtPayload }, @Body() dto: CreatePayoutDto) {
    const result = await this.svc.createTenantPayout(req.user.organizationId, dto)
    await this.record(req.user, 'billing.external_payout_created', dto.configId, {
      amountCents: dto.amountCents, currency: dto.currency, reference: dto.reference,
    })
    return result
  }
}
