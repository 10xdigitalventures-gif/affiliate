import { Global, Module } from '@nestjs/common'
import { EntitlementsService } from './entitlements.service'
import { EntitlementsController } from './entitlements.controller'
import { FeatureGuard } from './feature.guard'

/**
 * Global so any module can inject EntitlementsService / FeatureGuard for
 * plan-based limit checks and feature gating without re-importing.
 */
@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementsService, FeatureGuard],
  exports: [EntitlementsService, FeatureGuard],
})
export class EntitlementsModule {}
