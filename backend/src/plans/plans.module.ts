import { Global, Module } from '@nestjs/common'
import { PlansService } from './plans.service'
import { PlansController } from './plans.controller'
import { PublicPlansController } from './public-plans.controller'

@Global()
@Module({
  controllers: [PlansController, PublicPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
