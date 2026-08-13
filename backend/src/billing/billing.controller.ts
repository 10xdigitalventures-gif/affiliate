import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
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

/**
 * Platform billing console (super-admin only) + public webhook receivers.
 *
 * Everything under the guarded routes manages the platform's own gateways
 * (10x Digital Ventures charging its clients). The same service is scope-aware
 * so tenant-level gateways can be exposed to merchants later without changes.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  // ── Gateway configuration (super-admin) ───────────────────────────────
  @Get('config')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  listConfigs(@Query('scope') scope?: 'platform' | 'tenant', @Query('organizationId') organizationId?: string) {
    return this.svc.listConfigs(scope ?? 'platform', organizationId)
  }

  @Post('config')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  createConfig(@Body() dto: UpsertGatewayConfigDto) {
    return this.svc.createConfig(dto)
  }

  @Get('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  getConfig(@Param('id') id: string) {
    return this.svc.getConfig(id)
  }

  @Patch('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  updateConfig(@Param('id') id: string, @Body() dto: UpsertGatewayConfigDto) {
    return this.svc.updateConfig(id, dto)
  }

  @Delete('config/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  deleteConfig(@Param('id') id: string) {
    return this.svc.deleteConfig(id)
  }

  // ── Tenant billing actions (super-admin) ──────────────────────────────
  @Post('tenants/:orgId/setup')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  startSetup(@Param('orgId') orgId: string, @Body() dto: StartSetupDto) {
    return this.svc.startSetup(orgId, dto)
  }

  @Post('tenants/:orgId/charge')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  charge(@Param('orgId') orgId: string, @Body() dto: ChargeTenantDto) {
    return this.svc.chargeTenant(orgId, dto)
  }

  @Post('tenants/:orgId/subscription')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  startSubscription(@Param('orgId') orgId: string, @Body() dto: StartSubscriptionDto) {
    return this.svc.startSubscription(orgId, dto)
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
  createPayout(@Body() dto: CreatePayoutDto) {
    return this.svc.createPayout(dto)
  }

  // ── Manual billing-cycle trigger (super-admin; normally a cron) ─────────────
  @Post('run-cycle')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  runCycle() {
    return this.svc.runBillingCycle()
  }

  // ── Public webhook receivers (signature-verified inside the service) ────────
  // URL shape: /v1/billing/webhooks/{provider}/{configId}
  @Post('webhooks/:provider/:configId')
  async webhook(
    @Param('provider') provider: ProviderName,
    @Param('configId') configId: string,
    @Req() req: any,
  ) {
    const rawBody: string =
      (req.rawBody ? Buffer.from(req.rawBody).toString('utf8') : undefined) ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))
    return this.svc.handleWebhook(provider, configId, rawBody, req.headers ?? {})
  }
}
