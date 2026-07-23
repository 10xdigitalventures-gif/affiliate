import { Module } from '@nestjs/common'
import { TrackingController } from './tracking.controller'
import { TrackingService } from './tracking.service'
import { ApiKeysModule } from '../apikeys/apikeys.module'
import { OrdersModule } from '../orders/orders.module'

@Module({
  imports: [ApiKeysModule, OrdersModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
