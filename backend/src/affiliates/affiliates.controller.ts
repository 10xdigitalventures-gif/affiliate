import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { AffiliatesService } from './affiliates.service'
import { CreateAffiliateDto } from './dto/create-affiliate.dto'
import { SetAffiliateParentDto } from './dto/set-affiliate-parent.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('affiliates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get()
  @RequirePermissions('affiliates.read')
  list(@Req() req: { user: JwtPayload }, @Query('status') status?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.affiliates.list(req.user.organizationId, {
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    })
  }

  @Get(':id')
  @RequirePermissions('affiliates.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.affiliates.get(req.user.organizationId, id)
  }

  @Post()
  @RequirePermissions('affiliates.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateAffiliateDto) {
    return this.affiliates.create(req.user.organizationId, dto)
  }

  @Post(':id/approve')
  @RequirePermissions('affiliates.write')
  approve(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.affiliates.approve(req.user.organizationId, id)
  }

  /** PATCH /affiliates/:id/parent  { parentAffiliateId: string | null } */
  @Patch(':id/parent')
  @RequirePermissions('affiliates.write')
  setParent(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: SetAffiliateParentDto,
  ) {
    return this.affiliates.setParent(req.user.organizationId, id, body.parentAffiliateId ?? null)
  }

  /** GET /affiliates/:id/downline  — direct sub-affiliates + override earnings */
  @Get(':id/downline')
  @RequirePermissions('affiliates.read')
  downline(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.affiliates.getDownline(req.user.organizationId, id)
  }
}
