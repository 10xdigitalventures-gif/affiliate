import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiSecurity, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { ApiKeyGuard } from '../common/guards/apikey.guard'
import { OrdersService } from './orders.service'
import { IngestOrderDto } from './dto/ingest-order.dto'
import { RefundOrderDto } from './dto/refund-order.dto'
import { ApiRefundDto } from './dto/api-refund.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@ApiTags('orders')
@ApiBearerAuth('jwt')
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  list(@Req() req: { user: JwtPayload }, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.orders.list(req.user.organizationId, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    })
  }

  // Manual / normalised ingest (JWT auth). Phase 2 webhooks map platform payloads to this DTO.
  @Post('ingest')
  @RequirePermissions('orders.write')
  ingest(@Req() req: { user: JwtPayload }, @Body() dto: IngestOrderDto) {
    return this.orders.ingest(req.user.organizationId, dto)
  }

  /**
   * Programmatic order ingest via API key (machine-to-machine).
   * Header: x-api-key: aff_live_<key>  |  Required scope: orders.write
   */
  @ApiOperation({ summary: 'Programmatic order ingest via API key (M2M). Requires orders.write scope.' })
  @ApiSecurity('apiKey')
  @Post('ingest/apikey')
  @UseGuards(ApiKeyGuard)
  ingestWithApiKey(@Req() req: { user: { organizationId: string; scopes: string[] } }, @Body() dto: IngestOrderDto) {
    if (!req.user.scopes.includes('orders.write')) {
      throw new (require('@nestjs/common').ForbiddenException)('API key missing orders.write scope')
    }
    return this.orders.ingest(req.user.organizationId, dto)
  }

  @Post(':id/refund')
  @RequirePermissions('commissions.write')
  refund(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: RefundOrderDto) {
    return this.orders.refund(req.user.organizationId, id, dto.refundAmount)
  }

  /**
   * Programmatic refund via API key (M2M) — used by the WooCommerce plugin and
   * custom-store integrations. Identifies the order by its external id.
   * Header: x-api-key: aff_live_<key>  |  Required scope: orders.write
   */
  @ApiOperation({ summary: 'Programmatic refund via API key (M2M). Requires orders.write scope.' })
  @ApiSecurity('apiKey')
  @Post('refund/apikey')
  @UseGuards(ApiKeyGuard)
  refundWithApiKey(@Req() req: { user: { organizationId: string; scopes: string[] } }, @Body() dto: ApiRefundDto) {
    if (!req.user.scopes.includes('orders.write')) {
      throw new (require('@nestjs/common').ForbiddenException)('API key missing orders.write scope')
    }
    return this.orders.refundByExternal(req.user.organizationId, dto.storeId, dto.externalOrderId, dto.refundAmount)
  }
}
