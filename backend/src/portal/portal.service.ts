import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PayoutsService } from '../payouts/payouts.service'
import { EntitlementsService } from '../entitlements/entitlements.service'

/**
 * Affiliate self-service portal.
 * All queries are scoped to the affiliate identified on the JWT.
 *
 * Constructor args:
 *   prisma           — data layer
 *   payoutsService   — handles payout creation & business logic
 *   _linksService    — reserved for future link-management delegation
 *   entitlements     — plan entitlement checks (feature flags + numeric limits)
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutsService: PayoutsService,
    @Optional() private readonly _linksService: object | null,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async requireAffiliate(affiliateId?: string | null) {
    if (!affiliateId) throw new ForbiddenException('This account is not linked to an affiliate')
    const affiliate = await this.prisma.affiliate.findUnique({ where: { id: affiliateId } })
    if (!affiliate) throw new ForbiddenException('Affiliate not found')
    return affiliate
  }

  async summary(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    const [clicks, conversions, earned, pending] = await Promise.all([
      this.prisma.click.count({ where: { affiliateId: a.id } }),
      this.prisma.conversion.count({ where: { affiliateId: a.id } }),
      this.prisma.commission.aggregate({
        _sum: { amount: true },
        where: { affiliateId: a.id, status: { in: ['approved', 'payable', 'paid'] } },
      }),
      this.prisma.commission.aggregate({
        _sum: { amount: true },
        where: { affiliateId: a.id, status: 'pending' },
      }),
    ])
    return {
      affiliateCode: a.affiliateCode,
      referralSlug: a.referralSlug,
      lifetimeEarnings: Number(a.lifetimeEarnings),
      availableBalance: Number(a.availableBalance),
      clicks,
      conversions,
      earned: Number(earned._sum.amount ?? 0),
      pending: Number(pending._sum.amount ?? 0),
      conversionRate: clicks ? Math.round((conversions / clicks) * 1000) / 10 : 0,
    }
  }

  async links(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    const rows = await this.prisma.affiliateLink.findMany({
      where: { affiliateId: a.id },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({ ...r, clicksCount: Number(r.clicksCount) }))
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

  async addPayoutMethod(affiliateId?: string | null, method?: string) {
    const a = await this.requireAffiliate(affiliateId)
    if (!method) throw new BadRequestException('method required')
    return this.payoutsService.addPayoutMethod(a.id, method)
  }

  async deletePayoutMethod(affiliateId?: string | null, recordId?: string) {
    const a = await this.requireAffiliate(affiliateId)
    return this.payoutsService.deletePayoutMethod(a.id, recordId!)
  }

  /**
   * Request a payout for all payable commissions.
   *
   * Enforces the monthly payout-count limit from the affiliate's organisation plan:
   *   - -1  => unlimited (skip the count check)
   *   - >= 0 => hard cap; throws ForbiddenException when reached
   */
  async requestPayout(affiliateId?: string | null, method?: string, currency = 'USD') {
    const a = await this.requireAffiliate(affiliateId)
    if (!method) throw new BadRequestException('method required')

    const limit = await this.entitlements.getLimit(a.organizationId, 'payouts_per_month' as any)
    if (limit !== -1) {
      const used = await this.prisma.payout.count({ where: { affiliateId: a.id } })
      if (used >= limit) {
        throw new ForbiddenException(
          'Monthly payout limit reached for your current plan. Upgrade to request more payouts.',
        )
      }
    }

    return this.payoutsService.requestPayout(a.id, a.organizationId, method, currency)
  }
}
