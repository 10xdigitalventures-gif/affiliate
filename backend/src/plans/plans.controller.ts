import { Controller, Get } from '@nestjs/common'
import { PlansService } from './plans.service'

/** Public, unauthenticated pricing endpoint used by the marketing / signup pages. */
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.listPublic()
  }
}
