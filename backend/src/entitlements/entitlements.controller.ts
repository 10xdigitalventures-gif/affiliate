import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { EntitlementsService } from './entitlements.service'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('entitlements')
@UseGuards(JwtAuthGuard)
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /** The current org's resolved plan features, limits and live usage. */
  @Get()
  async me(@Req() req: { user: JwtPayload }) {
    const ctx = await this.entitlements.getContext(req.user.organizationId)
    const usage = await this.entitlements.usage(req.user.organizationId)
    return { ...ctx, usage }
  }
}
