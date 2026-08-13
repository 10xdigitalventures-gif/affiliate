import { Module } from '@nestjs/common'
import { BillingService } from './billing.service'
import { BillingController } from './billing.controller'
import { TenantBillingController } from './tenant-billing.controller'
import { GatewayFactory } from './gateways/gateway.factory'
import { SuperAdminGuard } from '../superadmin/superadmin.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'

/**
 * Billing & payment gateways (Whop + Swich). CryptoModule and PrismaModule are
 * global, so only the gateway factory + guard need to be provided here.
 */
@Module({
  controllers: [BillingController, TenantBillingController],
  providers: [BillingService, GatewayFactory, SuperAdminGuard, PermissionsGuard],
  exports: [BillingService],
})
export class BillingModule {}
