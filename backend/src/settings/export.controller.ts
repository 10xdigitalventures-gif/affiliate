import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard, RequirePermissions } from '../common/guards/permissions.guard'
import { JwtPayload } from '../auth/jwt.strategy'
import { ExportService } from './export.service'

/**
 * GDPR data export endpoint.
 * Streams the full tenant dataset as a downloadable JSON file.
 * Requires the settings.write permission so only workspace admins can trigger it.
 */
@Controller('settings/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get()
  @RequirePermissions('settings.write')
  async exportData(@Req() req: any, @Res() res: Response) {
    const user = req.user as JwtPayload
    const data = await this.exportService.exportTenantData(user.organizationId)
    const filename = `affiliate-export-${new Date().toISOString().slice(0, 10)}.json`
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.json(data)
  }
}
