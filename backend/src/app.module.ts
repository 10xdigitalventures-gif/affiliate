import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { RequestIdMiddleware } from './observability/request-id.middleware'
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { CryptoModule } from './common/crypto/crypto.module'
import { AuthModule } from './auth/auth.module'
import { AffiliatesModule } from './affiliates/affiliates.module'
import { LinksModule } from './links/links.module'
import { CouponsModule } from './coupons/coupons.module'
import { TrackingModule } from './tracking/tracking.module'
import { AttributionModule } from './attribution/attribution.module'
import { CommissionsModule } from './commissions/commissions.module'
import { OrdersModule } from './orders/orders.module'
import { StoresModule } from './stores/stores.module'
import { IntegrationsModule } from './integrations/integrations.module'
import { WebhooksModule } from './webhooks/webhooks.module'
import { ReportsModule } from './reports/reports.module'
import { PortalModule } from './portal/portal.module'
import { PayoutsModule } from './payouts/payouts.module'
import { QueueModule } from './queue/queue.module'
import { FraudModule } from './fraud/fraud.module'
import { AuditModule } from './audit/audit.module'
import { MailModule } from './mail/mail.module'
import { ApiKeysModule } from './apikeys/apikeys.module'
import { ApplicationsModule } from './applications/applications.module'
import { SettingsModule } from './settings/settings.module'
import { SignupModule } from './signup/signup.module'
import { HealthModule } from './health/health.module'
import { BulkModule } from './bulk/bulk.module'
import { NotificationsModule } from './notifications/notifications.module'
import { EntitlementsModule } from './entitlements/entitlements.module'
import { PlansModule } from './plans/plans.module'
import { SuperAdminModule } from './superadmin/superadmin.module'
import { BrandingModule } from './branding/branding.module'
import { DomainsModule } from './domains/domains.module'
import { ShopifyAppModule } from './shopify-app/shopify-app.module'
import { BillingModule } from './billing/billing.module'
import { TaxModule } from './tax/tax.module'
import { EmailTemplatesModule } from './email-templates/email-templates.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limiting.
    // When REDIS_URL is set (staging / production), state is stored in Redis so
    // every API replica shares the same counters. Falls back to in-memory
    // storage for local dev where Redis is not required.
    ThrottlerModule.forRootAsync({
      useFactory: async () => {
        const throttlers = [
          {
            ttl: Number(process.env.RATE_LIMIT_TTL_MS) || 60_000,
            limit: Number(process.env.RATE_LIMIT_MAX) || 120,
          },
        ]
        if (process.env.REDIS_URL) {
          // Dynamic import so the package is only loaded when Redis is used.
          // This prevents startup errors in dev environments without Redis.
          const { ThrottlerStorageRedisService } = await import('@nest-lab/throttler-storage-redis')
          return {
            throttlers,
            storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
          }
        }
        // No REDIS_URL: use the default in-memory store. Fine for local dev.
        if (process.env.NODE_ENV === 'production') {
          console.warn(
            '[ThrottlerModule] REDIS_URL is not set in production. ' +
              'Rate-limit counters are per-process and will not be shared across replicas. ' +
              'Set REDIS_URL to a shared Redis instance.',
          )
        }
        return { throttlers }
      },
    }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    AffiliatesModule,
    // Phase 1 - core engine
    LinksModule,
    CouponsModule,
    TrackingModule,
    AttributionModule,
    CommissionsModule,
    OrdersModule,
    // Phase 2 - integrations
    StoresModule,
    IntegrationsModule,
    WebhooksModule,
    // Phase 3 - dashboards, analytics and affiliate portal
    ReportsModule,
    PortalModule,
    // Phase 4 - payouts
    PayoutsModule,
    // Phase 5 - fraud, audit, queue
    QueueModule,
    FraudModule,
    AuditModule,
    MailModule,
    ApiKeysModule,
    ApplicationsModule,
    SettingsModule,
    SignupModule,
    HealthModule,
    BulkModule,
    NotificationsModule,
    EntitlementsModule,
    PlansModule,
    SuperAdminModule,
    BrandingModule,
    DomainsModule,
    // Phase 31 - 1-click store connect (Shopify OAuth app)
    ShopifyAppModule,
    // Phase 33 - platform billing (Whop + Swich gateways)
    BillingModule,
    // Phase 34 - affiliate tax collection (W-9 / W-8BEN, 1099-NEC reporting)
    TaxModule,
    // Phase 36 - per-tenant branded + editable email templates
    EmailTemplatesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
