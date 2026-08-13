import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RequirePermissions } from '../common/guards/permissions.guard'
import { PayoutsService } from './payouts.service'
import { CreatePayoutBatchDto, FailDto, MarkPaidDto } from './dto/payout.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@Controller('payouts')
@UseGuards(JwtAuthGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  /** GET /payouts?status=requested */
  @Get()
  @RequirePermissions('payouts.read')
  list(@Req() req: { user: JwtPayload }, @Query('status') status?: string) {
    return this.payouts.list(req.user.organizationId, status)
  }

  /** GET /payouts/:id */
  @Get(':id')
  @RequirePermissions('payouts.read')
  findOne(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.payouts.findOne(id, req.user.organizationId)
  }

  /** POST /payouts/batch */
  @Post('batch')
  @RequirePermissions('payouts.write')
  createBatch(@Req() req: { user: JwtPayload }, @Body() dto: CreatePayoutBatchDto) {
    return this.payouts.createBatch(req.user.organizationId, dto)
  }

  /** PATCH /payouts/:id/approve */
  @Patch(':id/approve')
  @RequirePermissions('payouts.write')
  approve(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.payouts.approve(id, req.user.organizationId)
  }

  /** POST /payouts/:id/process — send an approved payout via its provider (Stripe/Wise). */
  @Post(':id/process')
  @RequirePermissions('payouts.write')
  process(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.payouts.process(id, req.user.organizationId)
  }

  /** PATCH /payouts/:id/mark-paid */
  @Patch(':id/mark-paid')
  @RequirePermissions('payouts.write')
  markPaid(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.payouts.markPaid(id, req.user.organizationId, dto)
  }

  /** PATCH /payouts/:id/fail */
  @Patch(':id/fail')
  @RequirePermissions('payouts.write')
  fail(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() _dto: FailDto) {
    return this.payouts.fail(id, req.user.organizationId)
  }
}
