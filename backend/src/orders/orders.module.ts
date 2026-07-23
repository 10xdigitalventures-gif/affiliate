import { Module } from '@nestjs/common'
import { AttributionModule } from '../attribution/attribution.module'
import { CommissionsModule } from '../commissions/commissions.module'
import { FraudModule } from '../fraud/fraud.module'
import { ApiKeysModule } from '../apikeys/apikeys.module'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [AttributionModule, CommissionsModule, FraudModule, ApiKeysModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
