import { Module } from '@nestjs/common'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'
import { PayoutsModule } from '../payouts/payouts.module'
import { EntitlementsModule } from '../entitlements/entitlements.module'

@Module({
  imports: [PayoutsModule, EntitlementsModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
