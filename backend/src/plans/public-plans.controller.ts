import { Controller, Get } from '@nestjs/common'
import { PlansService } from './plans.service'

/**
 * Public, unauthenticated marketing endpoint.
 * Served at GET /v1/public/plans and consumed by the marketing website's
 * pricing page. Returns a presentation-friendly { plans: [...] } payload.
 */
@Controller('public')
export class PublicPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('plans')
  plansList() {
    return this.plans.listPublicForMarketing()
  }
}
