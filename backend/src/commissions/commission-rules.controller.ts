import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { CommissionRulesService } from './commission-rules.service'
import { CreateCommissionRuleDto } from './dto/commission-rule.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('commission-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CommissionRulesController {
  constructor(private readonly rules: CommissionRulesService) {}

  @Get()
  @RequirePermissions('commissions.read')
  list(@Req() req: { user: JwtPayload }) {
    return this.rules.list(req.user.organizationId)
  }

  @Post()
  @RequirePermissions('commissions.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateCommissionRuleDto) {
    return this.rules.create(req.user.organizationId, dto, req.user.sub)
  }

  @Delete(':id')
  @RequirePermissions('commissions.write')
  remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.rules.remove(req.user.organizationId, id, req.user.sub)
  }
}
