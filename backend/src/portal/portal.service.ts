import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PayoutsService } from '../payouts/payouts.service'
import { LinksService } from '../links/links.service'
import { CreatePortalLinkDto } from './dto/portal-link.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

/** Affiliate self-service. All queries scoped to the affiliate on the JWT. */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutsService: PayoutsService,
    private readonly linksService: LinksService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async requireAffiliate(affiliateId?: string | null) {
    if (!affiliateId) throw new ForbiddenException('This account is not linked to an affiliate')
    const affiliate = await this.prisma.affiliate.findUnique({ where: { id: affiliateId } })
    if (!affiliate) throw new ForbiddenException('Affiliate not found')
    if (affiliate.status !== 'approved') throw new ForbiddenException('Affiliate portal access is not active')
    return affiliate
  }

  async summary(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } })
    const [clicks, conversions, earnedRows, pendingRows, balance] = await Promise.all([
      this.prisma.click.count({ where: { affiliateId: a.id } }),
      this.prisma.conversion.count({ where: { affiliateId: a.id } }),
      this.prisma.commission.findMany({
        where: { affiliateId: a.id, status: { in: ['approved', 'payable', 'locked', 'paid'] } },
        include: { adjustments: true },
      }),
      this.prisma.commission.findMany({
        where: { affiliateId: a.id, status: 'pending' },
        include: { adjustments: true },
      }),
      this.prisma.affiliateBalance.findUnique({
        where: {
          affiliateId_currency: {
            affiliateId: a.id,
            currency: organization.defaultCurrency,
          },
        },
      }),
    ])
    const net = (rows: typeof earnedRows) => rows.reduce(
      (total, commission) => total + Number(commission.amount) + commission.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.delta), 0),
      0,
    )
    return {
      affiliateCode: a.affiliateCode,
      referralSlug: a.referralSlug,
      currency: organization.defaultCurrency,
      lifetimeEarnings: Number(balance?.lifetime ?? 0),
      availableBalance: Number(balance?.available ?? 0),
      clicks,
      conversions,
      earned: net(earnedRows),
      pending: net(pendingRows),
      conversionRate: clicks ? Math.round((conversions / clicks) * 1000) / 10 : 0,
    }
  }

  async links(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.linksService.listForAffiliate(a.organizationId, a.id)
  }

  async createLink(affiliateId: string | null | undefined, dto: CreatePortalLinkDto) {
    const a = await this.requireAffiliate(affiliateId)
    return this.linksService.createForAffiliate(a.organizationId, a.id, dto)
  }

  async deleteLink(affiliateId: string | null | undefined, id: string) {
    const a = await this.requireAffiliate(affiliateId)
    return this.linksService.removeForAffiliate(a.organizationId, a.id, id)
  }

  async coupons(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.prisma.coupon.findMany({
      where: { affiliateId: a.id },
      select: {
        id: true,
        code: true,
        discountType: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        store: { select: { id: true, name: true, domain: true, platform: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async orders(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.prisma.order.findMany({
      where: { affiliateId: a.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async commissions(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.prisma.commission.findMany({
      where: { affiliateId: a.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  // --- Payouts (delegated to PayoutsService via direct Prisma for portal) ---

  async payoutList(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.prisma.payout.findMany({
      where: { affiliateId: a.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async payoutMethods(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    return this.prisma.payoutMethodRecord.findMany({
      where: { affiliateId: a.id },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async addPayoutMethod(affiliateId?: string | null, method?: string, details?: Record<string, unknown>) {
    const a = await this.requireAffiliate(affiliateId)
    if (!method) throw new (await import('@nestjs/common')).BadRequestException('method required')
    return this.payoutsService.addPayoutMethod(a.id, method, details)
  }

  async deletePayoutMethod(affiliateId?: string | null, recordId?: string) {
    const a = await this.requireAffiliate(affiliateId)
    await this.prisma.payoutMethodRecord.deleteMany({ where: { id: recordId, affiliateId: a.id } })
    return { deleted: true }
  }

  async setDefaultPayoutMethod(affiliateId?: string | null, recordId?: string) {
    const a = await this.requireAffiliate(affiliateId)
    if (!recordId) throw new (await import('@nestjs/common')).BadRequestException('recordId required')
    return this.payoutsService.setDefaultPayoutMethod(a.id, recordId)
  }

  async requestPayout(affiliateId?: string | null, method?: string, currency?: string) {
    const a = await this.requireAffiliate(affiliateId)
    if (!method) throw new (await import('@nestjs/common')).BadRequestException('method required')
    const limit = await this.entitlements.getLimit(a.organizationId, 'monthlyPayoutRequestsPerAffiliate')
    if (limit >= 0) {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const used = await this.prisma.payout.count({
        where: { affiliateId: a.id, createdAt: { gte: monthStart } },
      })
      if (used >= limit) {
        throw new ForbiddenException(`Your plan allows ${limit} payout request(s) per affiliate each month`)
      }
    }
    return this.payoutsService.requestPayout(a.id, a.organizationId, method, currency)
  }
}
