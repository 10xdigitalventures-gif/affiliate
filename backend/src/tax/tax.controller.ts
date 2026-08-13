import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { TaxService } from './tax.service'
import { JwtPayload } from '../auth/jwt.strategy'
import { TaxSettingsDto } from '../settings/dto/tax-settings.dto'

@Controller('tax')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  /** GET /tax/report?year=2026 — year-end 1099-NEC reporting summary. */
  @Get('report')
  @RequirePermissions('reports.read')
  report(@Req() req: { user: JwtPayload }, @Query('year') year?: string) {
    const y = year ? Number(year) : new Date().getUTCFullYear()
    return this.tax.report(req.user.organizationId, y)
  }

  @Get('affiliates/:id')
  @RequirePermissions('affiliates.read')
  get(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.tax.adminGet(req.user.organizationId, id)
  }

  /** Reveal the decrypted TIN (finance only). */
  @Get('affiliates/:id/tin')
  @RequirePermissions('payouts.write')
  revealTin(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.tax.revealTin(req.user.organizationId, id)
  }

  @Post('affiliates/:id/verify')
  @RequirePermissions('affiliates.write')
  verify(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.tax.setReview(req.user.organizationId, id, 'verified')
  }

  @Post('affiliates/:id/reject')
  @RequirePermissions('affiliates.write')
  reject(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.tax.setReview(req.user.organizationId, id, 'rejected', body.note)
  }

  @Get('settings')
  @RequirePermissions('settings.write')
  getSettings(@Req() req: { user: JwtPayload }) {
    return this.tax.settings(req.user.organizationId)
  }

  @Patch('settings')
  @RequirePermissions('settings.write')
  updateSettings(@Req() req: { user: JwtPayload }, @Body() dto: TaxSettingsDto) {
    return this.tax.updateSettings(req.user.organizationId, dto)
  }
}
