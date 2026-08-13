import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { assertTenantMapComplete, scopeMode, tenantScopeMiddleware } from './tenant-scope'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    super()
    // Registered on this instance (rather than via $extends, which would return
    // a different client) so every existing `prisma.<model>` call site is
    // covered without being rewritten.
    this.$use(tenantScopeMiddleware())
  }

  async onModuleInit() {
    // Fails fast if a model was added to the schema without deciding how it is
    // tenant-scoped, so a new table cannot quietly become cross-tenant.
    assertTenantMapComplete(Prisma.dmmf.datamodel.models.map((m) => m.name))

    const mode = scopeMode()
    if (mode === 'enforce') {
      this.logger.log('Tenant scoping: ENFORCE - queries without a tenant context will fail')
    } else if (mode === 'warn') {
      this.logger.warn(
        'Tenant scoping: WARN - unscoped queries are logged but still run. ' +
          'Set TENANT_SCOPE_MODE=enforce once the warnings are clear.',
      )
    } else {
      this.logger.warn('Tenant scoping: OFF - no query-level tenant isolation is applied')
    }

    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
