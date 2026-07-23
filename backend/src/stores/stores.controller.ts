import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { StoresService } from './stores.service'
import { ConnectStoreDto } from './dto/connect-store.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('stores')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @RequirePermissions('stores.read')
  list(@Req() req: { user: JwtPayload }) {
    return this.stores.list(req.user.organizationId)
  }

  @Get(':id')
  @RequirePermissions('stores.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.stores.get(req.user.organizationId, id)
  }

  @Post('connect')
  @RequirePermissions('stores.write')
  connect(@Req() req: { user: JwtPayload }, @Body() dto: ConnectStoreDto) {
    return this.stores.connect(req.user.organizationId, dto)
  }
}
