import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateAffiliateDto } from './dto/create-affiliate.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService, private readonly entitlements: EntitlementsService) {}

  private randomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase() }

  async list(organizationId: string, params: { status?: string; skip?: number; take?: number }) {
    const where = { organizationId, ...(params.status ? { status: params.status as any } : {}) }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.affiliate.findMany({ where, skip: params.skip ?? 0, take: params.take ?? 25, orderBy: { createdAt: 'desc' } }),
      this.prisma.affiliate.count({ where }),
    ])
    return { items, total }
  }

  async get(organizationId: string, id: string) {
    const affiliate = await this.prisma.affiliate.findFirst({ where: { id, organizationId } })
    if (!affiliate) throw new NotFoundException('Affiliate not found')
    return affiliate
  }

  async create(organizationId: string, dto: CreateAffiliateDto) {
    await this.entitlements.assertWithinLimit(organizationId, 'affiliates')
    const suppliedCode = dto.affiliateCode?.trim().toUpperCase()
    const suppliedSlug = dto.referralSlug?.trim().toLowerCase()
    const attempts = suppliedCode ? 1 : 5
    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = suppliedCode || this.randomCode()
      try {
        return await this.prisma.affiliate.create({
          data: { organizationId, affiliateCode: code, referralSlug: suppliedSlug || code.toLowerCase(), status: 'pending' },
        })
      } catch (error: any) {
        if (suppliedCode || error?.code !== 'P2002' || attempt === attempts - 1) throw error
      }
    }
    throw new BadRequestException('Could not allocate a unique affiliate code')
  }

  async approve(organizationId: string, id: string) {
    await this.get(organizationId, id)
    return this.prisma.affiliate.update({ where: { id }, data: { status: 'approved' } })
  }

  async setParent(organizationId: string, id: string, parentAffiliateId: string | null) {
    await this.get(organizationId, id)
    if (parentAffiliateId) {
      if (parentAffiliateId === id) throw new BadRequestException('An affiliate cannot be its own parent')
      await this.get(organizationId, parentAffiliateId)
      let cursor: string | null = parentAffiliateId
      const seen = new Set<string>()
      while (cursor) {
        if (cursor === id) throw new BadRequestException('That parent would create a cycle in the upline')
        if (seen.has(cursor)) break
        seen.add(cursor)
        const node: { parentAffiliateId: string | null } | null = await this.prisma.affiliate.findFirst({
          where: { id: cursor, organizationId }, select: { parentAffiliateId: true },
        })
        cursor = node?.parentAffiliateId ?? null
      }
    }
    return this.prisma.affiliate.update({ where: { id }, data: { parentAffiliateId } })
  }

  async getDownline(organizationId: string, id: string) {
    await this.get(organizationId, id)
    const subs = await this.prisma.affiliate.findMany({
      where: { organizationId, parentAffiliateId: id },
      select: { id: true, affiliateCode: true, status: true, createdAt: true, _count: { select: { subAffiliates: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const overrides = await this.prisma.commission.aggregate({
      where: { affiliateId: id, tier: { gt: 0 } }, _sum: { amount: true }, _count: true,
    })
    return { subAffiliates: subs, overrideEarnings: Number(overrides._sum.amount ?? 0), overrideCount: overrides._count }
  }
}
