import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCouponDto } from './dto/create-coupon.dto'
import { UpdateCouponDto } from './dto/update-coupon.dto'
import { BulkGenerateCouponsDto } from './dto/bulk-generate-coupons.dto'

// Ambiguous characters (0/O, 1/I) removed for human-readable codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type ListCouponsParams = {
  storeId?: string
  affiliateId?: string
  status?: 'active' | 'expired' | 'disabled'
  search?: string
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureStore(organizationId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId } })
    if (!store) throw new NotFoundException('Store not found')
    return store
  }

  private async ensureAffiliate(organizationId: string, affiliateId: string) {
    const aff = await this.prisma.affiliate.findFirst({ where: { id: affiliateId, organizationId } })
    if (!aff) throw new NotFoundException('Affiliate not found')
    return aff
  }

  private randomCode(prefix = '', length = 6) {
    let s = ''
    for (let i = 0; i < length; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return `${prefix}${s}`
  }

  private isUniqueConflict(error: unknown) {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002'
  }

  async create(organizationId: string, dto: CreateCouponDto) {
    await this.ensureStore(organizationId, dto.storeId)
    if (dto.affiliateId) await this.ensureAffiliate(organizationId, dto.affiliateId)
    try {
      return await this.prisma.coupon.create({
        data: {
          storeId: dto.storeId,
          affiliateId: dto.affiliateId ?? null,
          code: dto.code.trim().toUpperCase(),
          discountType: dto.discountType ?? null,
          status: 'active',
        },
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new ConflictException('That coupon code already exists for this store')
      throw error
    }
  }

  async list(organizationId: string, params: ListCouponsParams = {}) {
    if (params.status && !new Set(['active', 'expired', 'disabled']).has(params.status)) {
      throw new BadRequestException('Invalid coupon status')
    }
    const where: any = { store: { organizationId } }
    if (params.storeId) where.storeId = params.storeId
    if (params.affiliateId) where.affiliateId = params.affiliateId
    if (params.status) where.status = params.status
    if (params.search) where.code = { contains: params.search, mode: 'insensitive' }
    return this.prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { id: true, name: true, platform: true } },
        affiliate: { select: { id: true, affiliateCode: true } },
        _count: { select: { orders: true } },
      },
    })
  }

  async get(organizationId: string, id: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, store: { organizationId } },
      include: {
        store: { select: { id: true, name: true, platform: true } },
        affiliate: { select: { id: true, affiliateCode: true } },
        _count: { select: { orders: true } },
      },
    })
    if (!coupon) throw new NotFoundException('Coupon not found')
    return coupon
  }

  async assign(organizationId: string, couponId: string, affiliateId: string) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id: couponId, store: { organizationId } } })
    if (!coupon) throw new NotFoundException('Coupon not found')
    await this.ensureAffiliate(organizationId, affiliateId)
    return this.prisma.coupon.update({ where: { id: couponId }, data: { affiliateId } })
  }

  async update(organizationId: string, id: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, store: { organizationId } } })
    if (!coupon) throw new NotFoundException('Coupon not found')
    if (dto.affiliateId) await this.ensureAffiliate(organizationId, dto.affiliateId)
    const data: any = {}
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase()
    if (dto.discountType !== undefined) data.discountType = dto.discountType
    if (dto.status !== undefined) data.status = dto.status
    if ('affiliateId' in dto) data.affiliateId = dto.affiliateId || null
    if ('expiresAt' in dto) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null
    try {
      return await this.prisma.coupon.update({ where: { id }, data })
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new ConflictException('That coupon code already exists for this store')
      throw error
    }
  }

  async setStatus(organizationId: string, id: string, status: 'active' | 'expired' | 'disabled') {
    return this.update(organizationId, id, { status })
  }

  async remove(organizationId: string, id: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, store: { organizationId } },
      select: { id: true, _count: { select: { orders: true } } },
    })
    if (!coupon) throw new NotFoundException('Coupon not found')
    if (coupon._count.orders > 0) {
      throw new ConflictException('Coupon has attributed orders and cannot be deleted; disable it instead')
    }
    await this.prisma.coupon.delete({ where: { id } })
    return { id, deleted: true }
  }

  /** Generate a batch of unique coupon codes for a store. */
  async bulkGenerate(organizationId: string, dto: BulkGenerateCouponsDto) {
    await this.ensureStore(organizationId, dto.storeId)
    if (dto.affiliateId) await this.ensureAffiliate(organizationId, dto.affiliateId)
    const prefix = dto.prefix?.trim().toUpperCase() ?? ''
    const length = dto.length ?? 6
    const created: Array<{ id: string; code: string }> = []
    for (let i = 0; i < dto.count; i++) {
      let coupon: { id: string; code: string } | null = null
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = this.randomCode(prefix, length)
        try {
          coupon = await this.prisma.coupon.create({
            data: {
              storeId: dto.storeId,
              affiliateId: dto.affiliateId ?? null,
              code: candidate,
              discountType: dto.discountType ?? null,
              status: 'active',
            },
          })
          break
        } catch (error) {
          if (!this.isUniqueConflict(error)) throw error
        }
      }
      if (!coupon) continue
      created.push({ id: coupon.id, code: coupon.code })
    }
    return { requested: dto.count, created: created.length, coupons: created }
  }

  async stats(organizationId: string) {
    const scope = { store: { organizationId } }
    const [total, active, disabled, expired, assigned] = await this.prisma.$transaction([
      this.prisma.coupon.count({ where: scope }),
      this.prisma.coupon.count({ where: { ...scope, status: 'active' } }),
      this.prisma.coupon.count({ where: { ...scope, status: 'disabled' } }),
      this.prisma.coupon.count({ where: { ...scope, status: 'expired' } }),
      this.prisma.coupon.count({ where: { ...scope, affiliateId: { not: null } } }),
    ])
    return { total, active, disabled, expired, assigned, unassigned: total - assigned }
  }

  // Used by attribution: find the active, non-expired affiliate coupon in a store.
  async findByCode(storeId: string, code: string) {
    const now = new Date()
    return this.prisma.coupon.findFirst({
      where: {
        storeId,
        code: code.trim().toUpperCase(),
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    })
  }
}
