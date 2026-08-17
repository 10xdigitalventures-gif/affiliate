import { Module } from '@nestjs/common'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'
import { PayoutsModule } from '../payouts/payouts.module'
import { TaxModule } from '../tax/tax.module'

// EntitlementsModule is @Global() — no need to import it here.
@Module({
  imports: [PayoutsModule, TaxModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
