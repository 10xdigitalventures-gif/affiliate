import { Module } from '@nestjs/common'
import { CouponsModule } from '../coupons/coupons.module'
import { AttributionService } from './attribution.service'

@Module({
  imports: [CouponsModule],
  providers: [AttributionService],
  exports: [AttributionService],
})
export class AttributionModule {}
