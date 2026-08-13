import { Global, Module } from '@nestjs/common'
import { TenantResolverService } from './tenant-resolver.service'

/**
 * Tenant resolution is needed by every unauthenticated entry point
 * (login, password reset, SSO, public affiliate pages), so it is global.
 */
@Global()
@Module({
  providers: [TenantResolverService],
  exports: [TenantResolverService],
})
export class TenantModule {}
