import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CreateAffiliateDto } from './dto/create-affiliate.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

@Injectable()
export class AffiliatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private randomCode() {
    return randomBytes(5).toString('hex').slice(0, 8).toUpperCase()
  }

  private isUniqueConflict(error: unknown) {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002'
  }

  async list(organizationId: string, params: { status?: string; skip?: number; take?: number }) {
    const validStatuses = new Set(['pending', 'approved', 'suspended', 'rejected'])
    if (params.status && !validStatuses.has(params.status)) throw new BadRequestException('Invalid affiliate status')
    const skip = Number.isInteger(params.skip) ? Math.max(params.skip!, 0) : 0
    const take = Number.isInteger(params.take) ? Math.min(Math.max(params.take!, 1), 100) : 25
    const where = { organizationId, ...(params.status ? { status: params.status as any } : {}) }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.affiliate.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
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
    const requestedCode = dto.affiliateCode?.trim().toUpperCase()
    const requestedSlug = dto.referralSlug?.trim().toLowerCase()
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = requestedCode || this.randomCode()
      try {
        return await this.prisma.affiliate.create({
          data: {
            organizationId,
            affiliateCode: code,
            referralSlug: requestedSlug || code.toLowerCase(),
            status: 'pending',
          },
        })
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error
        if (requestedCode || requestedSlug) {
          throw new ConflictException('Affiliate code or referral slug is already in use')
        }
        if (attempt === 4) throw new ConflictException('Could not allocate a unique affiliate code')
      }
    }
    throw new ConflictException('Could not allocate a unique affiliate code')
  }

  async approve(organizationId: string, id: string) {
    await this.get(organizationId, id)
    return this.prisma.affiliate.update({ where: { id }, data: { status: 'approved' } })
  }

  /**
   * Set (or clear with null) the recruiter/parent of an affiliate for multi-tier
   * overrides. Guards against self-parenting and against cycles in the upline.
   */
  async setParent(organizationId: string, id: string, parentAffiliateId: string | null) {
    await this.get(organizationId, id)
    if (parentAffiliateId) {
      if (parentAffiliateId === id) throw new BadRequestException('An affiliate cannot be its own parent')
      await this.get(organizationId, parentAffiliateId) // must exist in org
      // Walk the prospective parent's upline; if we hit `id`, it's a cycle.
      let cursor: string | null = parentAffiliateId
      const seen = new Set<string>()
      while (cursor) {
        if (cursor === id) throw new BadRequestException('That parent would create a cycle in the upline')
        if (seen.has(cursor)) break
        seen.add(cursor)
        const node: { parentAffiliateId: string | null } | null = await this.prisma.affiliate.findFirst({
          where: { id: cursor, organizationId },
          select: { parentAffiliateId: true },
        })
        cursor = node?.parentAffiliateId ?? null
      }
    }
    return this.prisma.affiliate.update({ where: { id }, data: { parentAffiliateId } })
  }

  /** Direct sub-affiliates (downline) of an affiliate, with override earnings. */
  async getDownline(organizationId: string, id: string) {
    await this.get(organizationId, id)
    const subs = await this.prisma.affiliate.findMany({
      where: { organizationId, parentAffiliateId: id },
      select: { id: true, affiliateCode: true, status: true, createdAt: true, _count: { select: { subAffiliates: true } } },
      orderBy: { createdAt: 'desc' },
    })
    // Total override commissions this affiliate earned from its downline (tier > 0).
    const overrides = await this.prisma.commission.aggregate({
      where: { affiliateId: id, tier: { gt: 0 } },
      _sum: { amount: true },
      _count: true,
    })
    return {
      subAffiliates: subs,
      overrideEarnings: Number(overrides._sum.amount ?? 0),
      overrideCount: overrides._count,
    }
  }
}
