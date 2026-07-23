import { Module } from '@nestjs/common'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'
import { TaxModule } from '../tax/tax.module'
import { PayoutsModule } from '../payouts/payouts.module'
import { LinksModule } from '../links/links.module'

@Module({
  imports: [TaxModule, PayoutsModule, LinksModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
