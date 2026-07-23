import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { ApiKeysService } from './apikeys.service'
import { CreateApiKeyDto } from './dto/create-apikey.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@ApiTags('api-keys')
@ApiBearerAuth('jwt')
@Controller('api-keys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @ApiOperation({ summary: 'List API keys (hash never exposed)' })
  @Get()
  @RequirePermissions('settings.write')
  list(@Req() req: { user: JwtPayload }) {
    return this.apiKeys.list(req.user.organizationId)
  }

  @ApiOperation({ summary: 'Create API key — returns the raw key ONCE' })
  @Post()
  @RequirePermissions('settings.write')
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(req.user.organizationId, dto)
  }

  @ApiOperation({ summary: 'Revoke (delete) an API key' })
  @Delete(':id')
  @RequirePermissions('settings.write')
  revoke(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.apiKeys.revoke(req.user.organizationId, id)
  }
}
