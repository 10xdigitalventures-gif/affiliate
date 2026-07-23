import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { EmailTemplatesService } from './email-templates.service'
import { UpdateEmailTemplateDto } from './dto/update-template.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('email-templates')
export class EmailTemplatesController {
  constructor(private readonly svc: EmailTemplatesService) {}

  /** List all templates with current (override-or-default) text. */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: { user: JwtPayload }) {
    return this.svc.list(req.user.organizationId)
  }

  /** Save a per-tenant text override for one template. */
  @Put(':key')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.write')
  update(@Req() req: { user: JwtPayload }, @Param('key') key: string, @Body() dto: UpdateEmailTemplateDto) {
    return this.svc.update(req.user.organizationId, key, dto)
  }

  /** Clear the override and fall back to the platform default. */
  @Post(':key/reset')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.write')
  reset(@Req() req: { user: JwtPayload }, @Param('key') key: string) {
    return this.svc.reset(req.user.organizationId, key)
  }

  /** Render a branded preview with sample data. */
  @Post(':key/preview')
  @UseGuards(JwtAuthGuard)
  preview(@Req() req: { user: JwtPayload }, @Param('key') key: string) {
    return this.svc.preview(req.user.organizationId, key)
  }
}
