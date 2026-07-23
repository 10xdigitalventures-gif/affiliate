import { Body, Controller, Get, Header, Param, Post, Req, UseGuards, BadRequestException } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { BulkService, ExportEntity } from './bulk.service'
import { JwtPayload } from '../auth/jwt.strategy'
import { FeatureGuard } from '../entitlements/feature.guard'
import { RequireFeature } from '../entitlements/require-feature.decorator'
import { ImportAffiliatesDto } from './dto/import-affiliates.dto'

const EXPORT_ENTITIES: ExportEntity[] = ['affiliates', 'commissions', 'orders', 'payouts']

@Controller('bulk')
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('bulkOperations')
export class BulkController {
  constructor(private readonly bulk: BulkService) {}

  /** GET /bulk/export/:entity -> CSV download */
  @Get('export/:entity')
  @RequirePermissions('reports.read')
  @Header('Content-Type', 'text/csv')
  async export(@Req() req: { user: JwtPayload }, @Param('entity') entity: string) {
    if (!EXPORT_ENTITIES.includes(entity as ExportEntity)) {
      throw new BadRequestException(`Unknown export entity "${entity}". Allowed: ${EXPORT_ENTITIES.join(', ')}`)
    }
    return this.bulk.exportCsv(req.user.organizationId, entity as ExportEntity)
  }

  /** GET /bulk/template/affiliates -> CSV template */
  @Get('template/affiliates')
  @RequirePermissions('affiliates.read')
  @Header('Content-Type', 'text/csv')
  affiliateTemplate() {
    return this.bulk.affiliateTemplate()
  }

  /**
   * POST /bulk/import/affiliates
   * Body: { csv: string }  (raw CSV text)
   */
  @Post('import/affiliates')
  @RequirePermissions('affiliates.write')
  importAffiliates(@Req() req: { user: JwtPayload }, @Body() body: ImportAffiliatesDto) {
    return this.bulk.importAffiliates(req.user.organizationId, body.csv)
  }
}
