import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { CommissionsService } from './commissions.service'
import { ReverseCommissionDto } from './dto/reverse-commission.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('commissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @RequirePermissions('commissions.read')
  list(
    @Req() req: { user: JwtPayload },
    @Query('affiliateId') affiliateId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.commissions.list(req.user.organizationId, {
      affiliateId,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    })
  }

  @Post(':id/approve')
  @RequirePermissions('commissions.write')
  approve(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.commissions.approve(req.user.organizationId, id)
  }

  @Post(':id/payable')
  @RequirePermissions('commissions.write')
  payable(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.commissions.markPayable(req.user.organizationId, id)
  }

  @Post(':id/reverse')
  @RequirePermissions('commissions.write')
  reverse(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: ReverseCommissionDto) {
    return this.commissions.reverse(req.user.organizationId, id, dto.reason, req.user.sub)
  }
}
