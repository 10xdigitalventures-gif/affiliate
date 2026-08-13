import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RequirePermissions } from '../common/guards/permissions.guard'
import { AuditService } from './audit.service'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** GET /audit?limit=100 */
  @Get()
  @RequirePermissions('settings.write')
  list(
    @Req() req: { user: JwtPayload },
    @Query('limit') limit?: string,
  ) {
    return this.audit.list(req.user.organizationId, limit ? parseInt(limit, 10) : 100)
  }
}
