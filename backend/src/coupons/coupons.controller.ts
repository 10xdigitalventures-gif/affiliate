import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { CouponsService } from './coupons.service'
import { CreateCouponDto } from './dto/create-coupon.dto'
import { UpdateCouponDto } from './dto/update-coupon.dto'
import { BulkGenerateCouponsDto } from './dto/bulk-generate-coupons.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@ApiTags('coupons')
@ApiBearerAuth('jwt')
@Controller('coupons')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermissions('affiliates.read')
  list(
    @Req() req: { user: JwtPayload },
    @Query('storeId') storeId?: string,
    @Query('affiliateId') affiliateId?: string,
    @Query('status') status?: 'active' | 'expired' | 'disabled',
    @Query('search') search?: string,
  ) {
    return this.coupons.list(req.user.organizationId, { storeId, affiliateId, status, search })
  }

  @Get('stats')
  @RequirePermissions('affiliates.read')
  stats(@Req() req: { user: JwtPayload }) {
    return this.coupons.stats(req.user.organizationId)
  }

  @Get(':id')
  @RequirePermissions('affiliates.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.coupons.get(req.user.organizationId, id)
  }

  @Post()
  @RequirePermissions('affiliates.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateCouponDto) {
    return this.coupons.create(req.user.organizationId, dto)
  }

  @Post('bulk-generate')
  @RequirePermissions('affiliates.write')
  bulkGenerate(@Req() req: { user: JwtPayload }, @Body() dto: BulkGenerateCouponsDto) {
    return this.coupons.bulkGenerate(req.user.organizationId, dto)
  }

  @Patch(':id')
  @RequirePermissions('affiliates.write')
  update(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(req.user.organizationId, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('affiliates.write')
  remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.coupons.remove(req.user.organizationId, id)
  }

  @Post(':id/assign/:affiliateId')
  @RequirePermissions('affiliates.write')
  assign(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Param('affiliateId') affiliateId: string) {
    return this.coupons.assign(req.user.organizationId, id, affiliateId)
  }
}
