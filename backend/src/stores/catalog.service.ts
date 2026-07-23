import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ShopifyService } from '../integrations/shopify.service'
import { WooCommerceService } from '../integrations/woocommerce.service'
import { GhlService } from '../integrations/ghl.service'
import { UpsertProductDto } from './dto/upsert-product.dto'
import { SyncCatalogDto } from './dto/sync-catalog.dto'

/** Platform-agnostic product shape used for catalog upserts. */
export type NormalizedProduct = {
  externalId: string
  name: string
  price: number
  sku?: string | null
  categoryName?: string | null
  categoryExternalId?: string | null
  status?: 'active' | 'inactive'
}

export type ListProductsParams = {
  storeId?: string
  categoryId?: string
  status?: 'active' | 'inactive'
  search?: string
  skip?: number
  take?: number
}

const STORE_SELECT = { id: true, name: true, platform: true } as const

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly woo: WooCommerceService,
    private readonly ghl: GhlService,
  ) {}

  private async ensureStore(organizationId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId } })
    if (!store) throw new NotFoundException('Store not found')
    return store
  }

  /** Returns the platform-specific product mapper, or null for unknown platforms. */
  private mapperFor(platform: string): ((storeId: string, raw: any) => NormalizedProduct) | null {
    if (platform === 'shopify') return (storeId, raw) => this.shopify.mapProduct(storeId, raw)
    if (platform === 'woocommerce') return (storeId, raw) => this.woo.mapProduct(storeId, raw)
    if (platform === 'ghl') return (storeId, raw) => this.ghl.mapProduct(storeId, raw)
    return null
  }

  async listProducts(organizationId: string, params: ListProductsParams) {
    if (params.status && !new Set(['active', 'inactive']).has(params.status)) {
      throw new BadRequestException('Invalid product status')
    }
    const { storeId, categoryId, status, search } = params
    const skip = Number.isInteger(params.skip) ? Math.max(params.skip!, 0) : 0
    const take = Number.isInteger(params.take) ? Math.min(Math.max(params.take!, 1), 100) : 25
    const where: any = { store: { organizationId } }
    if (storeId) where.storeId = storeId
    if (categoryId) where.categoryId = categoryId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
      ]
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { category: true, store: { select: STORE_SELECT } },
      }),
      this.prisma.product.count({ where }),
    ])
    return { items, total }
  }

  async getProduct(organizationId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, store: { organizationId } },
      include: { category: true, store: { select: STORE_SELECT } },
    })
    if (!product) throw new NotFoundException('Product not found')
    return product
  }

  async listCategories(organizationId: string) {
    return this.prisma.category.findMany({ where: { organizationId }, orderBy: { name: 'asc' } })
  }

  async stats(organizationId: string) {
    const [total, active, categories, stores] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { store: { organizationId } } }),
      this.prisma.product.count({ where: { store: { organizationId }, status: 'active' } }),
      this.prisma.category.count({ where: { organizationId } }),
      this.prisma.store.count({ where: { organizationId } }),
    ])
    return { total, active, inactive: total - active, categories, stores }
  }

  /** Find-or-create a category for the org by name (Category has no unique key). */
  private async resolveCategory(organizationId: string, name?: string | null, externalId?: string | null) {
    const trimmed = (name ?? '').trim()
    if (!trimmed) return null
    const existing = await this.prisma.category.findFirst({ where: { organizationId, name: trimmed } })
    if (existing) return existing
    return this.prisma.category.create({
      data: { organizationId, name: trimmed, externalId: externalId ?? null },
    })
  }

  /** Upsert a single normalised product by (storeId, externalId). */
  async upsertProduct(organizationId: string, storeId: string, np: NormalizedProduct) {
    await this.ensureStore(organizationId, storeId)
    const category = await this.resolveCategory(organizationId, np.categoryName, np.categoryExternalId)
    const data = {
      name: np.name,
      sku: np.sku ?? null,
      price: np.price,
      status: np.status ?? 'active',
      categoryId: category?.id ?? null,
    }
    return this.prisma.product.upsert({
      where: { storeId_externalId: { storeId, externalId: np.externalId } },
      create: { storeId, externalId: np.externalId, ...data },
      update: data,
    })
  }

  /** Manual single-product create/update from the dashboard. */
  async manualUpsert(organizationId: string, dto: UpsertProductDto) {
    return this.upsertProduct(organizationId, dto.storeId, {
      externalId: dto.externalId,
      name: dto.name,
      sku: dto.sku ?? null,
      categoryName: dto.categoryName ?? null,
      price: dto.price,
      status: dto.status,
    })
  }

  /**
   * Bulk sync a store's catalog. Applies the platform mapper unless the payload
   * is already normalised. Records a SyncJob and updates store.lastSyncedAt.
   */
  async syncCatalog(organizationId: string, storeId: string, dto: SyncCatalogDto) {
    const store = await this.ensureStore(organizationId, storeId)
    const job = await this.prisma.syncJob.create({
      data: { storeId, jobType: 'catalog', status: 'running' },
    })
    try {
      const mapper = this.mapperFor(store.platform)
      const raws = dto.products ?? []
      const normalized: NormalizedProduct[] = raws.map((raw) => {
        if (dto.normalized) return raw as unknown as NormalizedProduct
        if (mapper) return mapper(storeId, raw)
        return raw as unknown as NormalizedProduct
      })
      let created = 0
      let updated = 0
      let skipped = 0
      for (const np of normalized) {
        if (!this.validNormalizedProduct(np)) {
          skipped++
          continue
        }
        const existing = await this.prisma.product.findUnique({
          where: { storeId_externalId: { storeId, externalId: np.externalId } },
        })
        await this.upsertProduct(organizationId, storeId, np)
        if (existing) updated++
        else created++
      }
      await this.prisma.syncJob.update({ where: { id: job.id }, data: { status: 'success' } })
      await this.prisma.store.update({ where: { id: storeId }, data: { lastSyncedAt: new Date() } })
      return { storeId, jobId: job.id, total: normalized.length, created, updated, skipped }
    } catch (err) {
      await this.prisma.syncJob.update({ where: { id: job.id }, data: { status: 'failed' } })
      throw err
    }
  }

  private validNormalizedProduct(value: unknown): value is NormalizedProduct {
    if (!value || typeof value !== 'object') return false
    const product = value as Partial<NormalizedProduct>
    return (
      typeof product.externalId === 'string' && product.externalId.trim().length > 0 && product.externalId.length <= 255 &&
      typeof product.name === 'string' && product.name.trim().length > 0 && product.name.length <= 500 &&
      typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0 && product.price <= 1_000_000_000_000 &&
      (product.sku == null || (typeof product.sku === 'string' && product.sku.length <= 255)) &&
      (product.categoryName == null || (typeof product.categoryName === 'string' && product.categoryName.length <= 255)) &&
      (product.categoryExternalId == null || (typeof product.categoryExternalId === 'string' && product.categoryExternalId.length <= 255)) &&
      (product.status == null || product.status === 'active' || product.status === 'inactive')
    )
  }
}
