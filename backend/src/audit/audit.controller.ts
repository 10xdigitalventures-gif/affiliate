import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard, RequirePermissions } from '../common/guards/permissions.guard'
import { AuditService } from './audit.service'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** GET /audit?limit=100 */
  @Get()
  @RequirePermissions('settings.write')
  list(
    @Req() req: { user: JwtPayload },
    @Query('limit') limit?: string,
  ) {
    const parsed = limit === undefined ? 100 : Number(limit)
    const safeLimit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 250) : 100
    return this.audit.list(req.user.organizationId, safeLimit)
  }
}
