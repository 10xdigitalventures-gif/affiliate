import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TaxService } from '../tax/tax.service'

/** Affiliate self-service. All queries scoped to the affiliate on the JWT. */
@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService, private readonly tax: TaxService) {}

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
    if (!method) throw new (await import('@nestjs/common')).BadRequestException('method required')
    return this.prisma.payoutMethodRecord.create({
      data: { affiliateId: a.id, method: method as any, isDefault: false },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async deletePayoutMethod(affiliateId?: string | null, recordId?: string) {
    const a = await this.requireAffiliate(affiliateId)
    await this.prisma.payoutMethodRecord.deleteMany({ where: { id: recordId, affiliateId: a.id } })
    return { deleted: true }
  }

  async requestPayout(affiliateId?: string | null, method?: string) {
    const a = await this.requireAffiliate(affiliateId)
    if (!method) throw new (await import('@nestjs/common')).BadRequestException('method required')
    await this.tax.assertPayoutAllowed(a.organizationId, a.id)
    const { BadRequestException } = await import('@nestjs/common')
    // Rule 5 hardening: run selection + claim inside one transaction.
    // We claim all eligible commissions atomically with a single guarded
    // updateMany so a concurrent requestPayout cannot double-claim the same
    // earnings (TOCTOU / double-claim protection).
    return this.prisma.$transaction(async (tx) => {
      const commissions = await tx.commission.findMany({
        where: { affiliateId: a.id, status: 'payable', payoutItemId: null },
      })
      if (commissions.length === 0)
        throw new BadRequestException('No payable commissions available')
      const total = commissions.reduce((s, c) => s + Number(c.amount), 0)
      const payout = await tx.payout.create({
        data: {
          organizationId: a.organizationId,
          affiliateId: a.id,
          amount: total,
          currency: 'USD',
          method: method as any,
          status: 'requested',
          items: { create: commissions.map((c) => ({ amount: c.amount })) },
        },
      })
      // Atomically claim all commissions in one guarded updateMany.
      // If any commission was already claimed by a concurrent request the count
      // will be less than expected and we abort the whole transaction.
      const claimResult = await tx.commission.updateMany({
        where: {
          id: { in: commissions.map((c) => c.id) },
          payoutItemId: null,
        },
        data: { status: 'processing' },
      })
      if (claimResult.count < commissions.length)
        throw new BadRequestException('Payout already in progress — please retry')
      return { id: payout.id, amount: total, currency: 'USD', status: 'requested' }
    })
  }
}
