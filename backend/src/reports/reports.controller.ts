import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { ReportsService } from './reports.service'
import { JwtPayload } from '../auth/jwt.strategy'

function rangeFromQuery(q: { days?: string; from?: string; to?: string }) {
  return {
    days: q.days ? Number(q.days) : undefined,
    from: q.from,
    to: q.to,
  }
}

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  summary(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.summary(req.user.organizationId, rangeFromQuery({ days, from, to }))
  }

  @Get('timeseries')
  @RequirePermissions('reports.read')
  timeseries(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.timeseries(req.user.organizationId, rangeFromQuery({ days, from, to }))
  }

  @Get('top-affiliates')
  @RequirePermissions('reports.read')
  topAffiliates(
    @Req() req: { user: JwtPayload },
    @Query('limit') limit?: string,
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.topAffiliates(
      req.user.organizationId,
      limit ? Number(limit) : 10,
      rangeFromQuery({ days, from, to }),
    )
  }

  @Get('by-source')
  @RequirePermissions('reports.read')
  bySource(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.bySource(req.user.organizationId, rangeFromQuery({ days, from, to }))
  }

  @Get('by-store')
  @RequirePermissions('reports.read')
  byStore(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.byStore(req.user.organizationId, rangeFromQuery({ days, from, to }))
  }

  @Get('by-product')
  @RequirePermissions('reports.read')
  byProduct(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reports.byProduct(
      req.user.organizationId,
      rangeFromQuery({ days, from, to }),
      limit ? Number(limit) : 10,
    )
  }

  @Get('by-category')
  @RequirePermissions('reports.read')
  byCategory(
    @Req() req: { user: JwtPayload },
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.byCategory(req.user.organizationId, rangeFromQuery({ days, from, to }))
  }

  @Get('export')
  @RequirePermissions('reports.read')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="export.csv"')
  export(
    @Req() req: { user: JwtPayload },
    @Query('entity') entity?: string,
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const e = entity === 'orders' ? 'orders' : entity === 'affiliates' ? 'affiliates' : 'commissions'
    return this.reports.exportCsv(req.user.organizationId, e, rangeFromQuery({ days, from, to }))
  }
}
