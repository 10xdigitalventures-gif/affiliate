import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PortalService } from './portal.service'
import { TaxService } from '../tax/tax.service'
import { TaxFormDto } from '../tax/dto/tax-form.dto'
import { JwtPayload } from '../auth/jwt.strategy'

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
  requestPayout(@Req() req: { user: JwtPayload }, @Body() body: { method: string }) {
    return this.portal.requestPayout(req.user.affiliateId, body.method)
  }

  @Get('payout-methods')
  payoutMethods(@Req() req: { user: JwtPayload }) {
    return this.portal.payoutMethods(req.user.affiliateId)
  }

  @Post('payout-methods')
  addPayoutMethod(@Req() req: { user: JwtPayload }, @Body() body: { method: string }) {
    return this.portal.addPayoutMethod(req.user.affiliateId, body.method)
  }

  @Delete('payout-methods/:id')
  deletePayoutMethod(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.portal.deletePayoutMethod(req.user.affiliateId, id)
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
