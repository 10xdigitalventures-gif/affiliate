import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { CatalogService } from './catalog.service'
import { UpsertProductDto } from './dto/upsert-product.dto'
import { SyncCatalogDto } from './dto/sync-catalog.dto'
import { JwtPayload } from '../auth/jwt.strategy'

@ApiTags('catalog')
@ApiBearerAuth('jwt')
@Controller('catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @RequirePermissions('stores.read')
  listProducts(
    @Req() req: { user: JwtPayload },
    @Query('storeId') storeId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: 'active' | 'inactive',
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.catalog.listProducts(req.user.organizationId, {
      storeId,
      categoryId,
      status,
      search,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    })
  }

  @Get('products/:id')
  @RequirePermissions('stores.read')
  getProduct(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.catalog.getProduct(req.user.organizationId, id)
  }

  @Get('categories')
  @RequirePermissions('stores.read')
  listCategories(@Req() req: { user: JwtPayload }) {
    return this.catalog.listCategories(req.user.organizationId)
  }

  @Get('stats')
  @RequirePermissions('stores.read')
  stats(@Req() req: { user: JwtPayload }) {
    return this.catalog.stats(req.user.organizationId)
  }

  @Post('products')
  @RequirePermissions('stores.write')
  upsertProduct(@Req() req: { user: JwtPayload }, @Body() dto: UpsertProductDto) {
    return this.catalog.manualUpsert(req.user.organizationId, dto)
  }

  @Post('stores/:id/sync')
  @RequirePermissions('stores.write')
  sync(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: SyncCatalogDto) {
    return this.catalog.syncCatalog(req.user.organizationId, id, dto)
  }
}
