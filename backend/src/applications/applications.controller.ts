import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { ApplicationsService } from './applications.service'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('applications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequirePermissions('affiliates.read')
  list(@Req() req: { user: JwtPayload }, @Query('status') status?: string) {
    return this.applications.list(req.user.organizationId, status)
  }

  @Post(':id/approve')
  @RequirePermissions('affiliates.write')
  approve(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.applications.approve(req.user.organizationId, id, req.user.sub)
  }

  @Post(':id/reject')
  @RequirePermissions('affiliates.write')
  reject(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.applications.reject(req.user.organizationId, id)
  }
}
