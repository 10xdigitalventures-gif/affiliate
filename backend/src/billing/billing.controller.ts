import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from '../superadmin/superadmin.guard'
import { BillingService } from './billing.service'
import { ProviderName } from './gateways/gateway.types'
import {
  ChargeTenantDto,
  CreatePayoutDto,
  StartSetupDto,
  StartSubscriptionDto,
  UpsertGatewayConfigDto,
} from './dto/billing.dto'
import { AuditService } from '../audit/audit.service'
import { JwtPayload } from '../auth/jwt.strategy'

/**
 * Platform billing console (super-admin only) + public webhook receivers.
 *
 * Everything under the guarded routes manages the platform's own gateways
 * (10x Digital Ventures charging its clients). The same service is scope-aware
 * so tenant-level gateways can be exposed to merchants later without changes.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService, private readonly audit: AuditService) {}

  private record(actor: JwtPayload, action: string, resourceType: string, resourceId?: string, newValue?: unknown) {
    return this.audit.log({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action,
      resourceType,
      resourceId,
      newValue,
    })
  }

  // ── Gateway configuration (super-admin) ───────────────────────────────
  @Get('config')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  listConfigs(@Query('scope') scope?: 'platform' | 'tenant', @Query('organizationId') organizationId?: string) {
    return this.svc.listConfigs(scope ?? 'platform', organizationId)
  }

  @Post('config')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async createConfig(@Body() dto: UpsertGatewayConfigDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.createConfig(dto)
    await this.record(req.user, 'platform.billing.gateway_created', 'PaymentGatewayConfig', result.id, {
      provider: result.provider, scope: result.scope, organizationId: result.organizationId,
    })
    return result
  }

  @Get('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  getConfig(@Param('id') id: string) {
    return this.svc.getConfig(id)
  }

  @Patch('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async updateConfig(@Param('id') id: string, @Body() dto: UpsertGatewayConfigDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.updateConfig(id, dto)
    await this.record(req.user, 'platform.billing.gateway_updated', 'PaymentGatewayConfig', id, {
      provider: result.provider, isActive: result.isActive, isLive: result.isLive, isDefault: result.isDefault,
    })
    return result
  }

  @Delete('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async deleteConfig(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.deleteConfig(id)
    await this.record(req.user, 'platform.billing.gateway_deleted', 'PaymentGatewayConfig', id)
    return result
  }

  // ── Tenant billing actions (super-admin) ──────────────────────────────
  @Post('tenants/:orgId/setup')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async startSetup(@Param('orgId') orgId: string, @Body() dto: StartSetupDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.startSetup(orgId, dto)
    await this.record(req.user, 'platform.billing.setup_started', 'Organization', orgId, { provider: result.provider })
    return result
  }

  @Post('tenants/:orgId/charge')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async charge(@Param('orgId') orgId: string, @Body() dto: ChargeTenantDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.chargeTenant(orgId, dto)
    await this.record(req.user, 'platform.billing.tenant_charged', 'BillingInvoice', result.invoiceId, {
      organizationId: orgId, amountCents: dto.amountCents, currency: dto.currency,
    })
    return result
  }

  @Post('tenants/:orgId/subscription')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async startSubscription(@Param('orgId') orgId: string, @Body() dto: StartSubscriptionDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.startSubscription(orgId, dto)
    await this.record(req.user, 'platform.billing.subscription_started', 'Organization', orgId, { planId: dto.planId })
    return result
  }

  @Get('tenants/:orgId/invoices')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  tenantInvoices(@Param('orgId') orgId: string) {
    return this.svc.listInvoices(orgId)
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  allInvoices() {
    return this.svc.listInvoices()
  }

  // ── Payouts (super-admin) ──────────────────────────────────────────
  @Post('payouts')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async createPayout(@Body() dto: CreatePayoutDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.createPayout(dto)
    await this.record(req.user, 'platform.billing.external_payout_created', 'PaymentGatewayConfig', dto.configId, {
      amountCents: dto.amountCents, currency: dto.currency, reference: dto.reference,
    })
    return result
  }

  // ── Manual billing-cycle trigger (super-admin; normally a cron) ─────────────
  @Post('run-cycle')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async runCycle(@Req() req: { user: JwtPayload }) {
    const result = await this.svc.runBillingCycle()
    await this.record(req.user, 'platform.billing.cycle_run', 'BillingCycle', undefined, result)
    return result
  }

  // ── Public webhook receivers (signature-verified inside the service) ────────
  // URL shape: /v1/billing/webhooks/{provider}/{configId}
  @Post('webhooks/:provider/:configId')
  async webhook(
    @Param('provider') provider: ProviderName,
    @Param('configId') configId: string,
    @Req() req: any,
  ) {
    if (!req.rawBody) throw new BadRequestException('Raw webhook body is required for signature verification')
    const rawBody = Buffer.from(req.rawBody).toString('utf8')
    return this.svc.handleWebhook(provider, configId, rawBody, req.headers ?? {})
  }
}
