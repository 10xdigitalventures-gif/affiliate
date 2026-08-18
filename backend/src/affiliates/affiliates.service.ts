import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
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
    return Math.random().toString(36).slice(2, 8).toUpperCase()
  }

  /** Normalize identifiers: code → UPPER_TRIMMED, slug → lower_trimmed. */
  private normalizeDto(dto: CreateAffiliateDto) {
    return {
      affiliateCode: dto.affiliateCode != null ? dto.affiliateCode.trim().toUpperCase() : undefined,
      referralSlug: dto.referralSlug != null ? dto.referralSlug.trim().toLowerCase() : undefined,
    }
  }

  async list(organizationId: string, params: { status?: string; skip?: number; take?: number }) {
    const where = { organizationId, ...(params.status ? { status: params.status as any } : {}) }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.affiliate.findMany({
        where,
        skip: params.skip ?? 0,
        take: params.take ?? 25,
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
    const norm = this.normalizeDto(dto)
    const code = norm.affiliateCode || this.randomCode()
    const slug = norm.referralSlug || code.toLowerCase()

    // Retry once on unique-code collision (P2002) so auto-generated codes can
    // self-heal without surfacing a DB error to callers.
    for (let attempt = 0; attempt < 2; attempt++) {
      const codeToUse = attempt === 0 ? code : this.randomCode()
      try {
        return await this.prisma.affiliate.create({
          data: {
            organizationId,
            affiliateCode: codeToUse,
            referralSlug: attempt === 0 ? slug : codeToUse.toLowerCase(),
            status: 'pending',
          },
        })
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt === 0) continue
        throw err
      }
    }
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
      // Walk the prospective parent's upline within the tenant; if we hit `id`,
      // it's a cycle. Using findFirst with organizationId ensures we never
      // traverse nodes belonging to a different tenant.
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
