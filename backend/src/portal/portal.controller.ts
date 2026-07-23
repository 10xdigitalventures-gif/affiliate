import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PortalService } from './portal.service'
import { TaxService } from '../tax/tax.service'
import { TaxFormDto } from '../tax/dto/tax-form.dto'
import { JwtPayload } from '../auth/jwt.strategy'
import { AddPortalPayoutMethodDto, RequestPortalPayoutDto } from './dto/portal-payout.dto'
import { CreatePortalLinkDto } from './dto/portal-link.dto'
import { Throttle } from '@nestjs/throttler'

// Affiliate portal — JWT only (no admin permissions required); data scoped to req.user.affiliateId.
@Controller('portal')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(private readonly portal: PortalService, private readonly tax: TaxService) {}

  @Get('summary')
  summary(@Req() req: { user: JwtPayload }) {
    return this.portal.summary(req.user.affiliateId)
  }

  @Get('links')
  links(@Req() req: { user: JwtPayload }) {
    return this.portal.links(req.user.affiliateId)
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('links')
  createLink(@Req() req: { user: JwtPayload }, @Body() dto: CreatePortalLinkDto) {
    return this.portal.createLink(req.user.affiliateId, dto)
  }

  @Delete('links/:id')
  deleteLink(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.portal.deleteLink(req.user.affiliateId, id)
  }

  @Get('coupons')
  coupons(@Req() req: { user: JwtPayload }) {
    return this.portal.coupons(req.user.affiliateId)
  }

  @Get('orders')
  orders(@Req() req: { user: JwtPayload }) {
    return this.portal.orders(req.user.affiliateId)
  }

  @Get('commissions')
  commissions(@Req() req: { user: JwtPayload }) {
    return this.portal.commissions(req.user.affiliateId)
  }

  @Get('payouts')
  payoutList(@Req() req: { user: JwtPayload }) {
    return this.portal.payoutList(req.user.affiliateId)
  }

  @Post('payouts/request')
  requestPayout(@Req() req: { user: JwtPayload }, @Body() body: RequestPortalPayoutDto) {
    return this.portal.requestPayout(req.user.affiliateId, body.method, body.currency)
  }

  @Get('payout-methods')
  payoutMethods(@Req() req: { user: JwtPayload }) {
    return this.portal.payoutMethods(req.user.affiliateId)
  }

  @Post('payout-methods')
  addPayoutMethod(@Req() req: { user: JwtPayload }, @Body() body: AddPortalPayoutMethodDto) {
    return this.portal.addPayoutMethod(req.user.affiliateId, body.method, body.details)
  }

  @Delete('payout-methods/:id')
  deletePayoutMethod(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.portal.deletePayoutMethod(req.user.affiliateId, id)
  }

  @Post('payout-methods/:id/default')
  setDefaultPayoutMethod(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.portal.setDefaultPayoutMethod(req.user.affiliateId, id)
  }

  @Get('tax')
  taxStatus(@Req() req: { user: JwtPayload }) {
    return this.tax.portalStatus(req.user.affiliateId)
  }

  @Post('tax')
  submitTax(@Req() req: { user: JwtPayload }, @Body() dto: TaxFormDto) {
    return this.tax.portalSubmit(req.user.affiliateId, dto)
  }
}
