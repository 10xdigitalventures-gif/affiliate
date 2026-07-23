import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { LinksService } from './links.service'
import { CreateLinkDto } from './dto/create-link.dto'
import { UpdateLinkDto } from './dto/update-link.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@ApiTags('links')
@ApiBearerAuth('jwt')
@Controller('links')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @RequirePermissions('affiliates.read')
  list(
    @Req() req: { user: JwtPayload },
    @Query('affiliateId') affiliateId?: string,
    @Query('storeId') storeId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('search') search?: string,
  ) {
    return this.links.list(req.user.organizationId, { affiliateId, storeId, campaignId, search })
  }

  @Get('stats')
  @RequirePermissions('affiliates.read')
  stats(@Req() req: { user: JwtPayload }) {
    return this.links.stats(req.user.organizationId)
  }

  @Get('affiliate/:affiliateId')
  @RequirePermissions('affiliates.read')
  listForAffiliate(@Req() req: { user: JwtPayload }, @Param('affiliateId') affiliateId: string) {
    return this.links.listForAffiliate(req.user.organizationId, affiliateId)
  }

  @Get(':id')
  @RequirePermissions('affiliates.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.links.get(req.user.organizationId, id)
  }

  @Post()
  @RequirePermissions('affiliates.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateLinkDto) {
    return this.links.create(req.user.organizationId, dto)
  }

  @Patch(':id')
  @RequirePermissions('affiliates.write')
  update(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: UpdateLinkDto) {
    return this.links.update(req.user.organizationId, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('affiliates.write')
  remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.links.remove(req.user.organizationId, id)
  }
}
