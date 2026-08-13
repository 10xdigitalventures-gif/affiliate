import { Module } from '@nestjs/common'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'
import { TaxModule } from '../tax/tax.module'

@Module({
  imports: [TaxModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
