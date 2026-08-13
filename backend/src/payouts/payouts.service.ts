import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { PayoutProviderService } from './providers/payout-provider.service'
import { TaxService } from '../tax/tax.service'
import * as T from '../mail/templates'
import { CreatePayoutBatchDto, MarkPaidDto } from './dto/payout.dto'

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger('PayoutsService')
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    private readonly providers: PayoutProviderService,
    private readonly tax: TaxService,
  ) {}

  /** Decrypt the affiliate's default payout-method destination details. */
  private async resolveDestination(affiliateId: string, method: string): Promise<Record<string, unknown>> {
    const record = await this.prisma.payoutMethodRecord.findFirst({
      where: { affiliateId, method: method as any },
      orderBy: { isDefault: 'desc' },
    })
    if (!record?.detailsEnc) return {}
    try {
      return JSON.parse(this.crypto.decrypt(Buffer.from(record.detailsEnc)))
    } catch {
      return {}
    }
  }

  /**
   * Shared settlement: mark commissions paid, deduct balance, flip payout to paid,
   * audit, and email the affiliate. Used by both automated `process` and manual `markPaid`.
   */
  private async settlePaid(
    organizationId: string,
    payout: { id: string; affiliateId: string; amount: any; currency: string | null; method: string; items: { id: string }[] },
    reference?: string | null,
  ) {
    const itemIds = payout.items.map((item) => item.id)
    await this.prisma.$transaction([
      this.prisma.commission.updateMany({ where: { payoutItemId: { in: itemIds } }, data: { status: 'paid' } }),
      this.prisma.affiliate.update({
        where: { id: payout.affiliateId },
        data: { availableBalance: { decrement: Number(payout.amount) } },
      }),
      this.prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'paid', transactionReference: reference ?? undefined },
      }),
    ])
    await this.audit.log({ organizationId, action: 'payout.paid', resourceType: 'payout', resourceId: payout.id, newValue: { status: 'paid', ref: reference } }).catch(() => {})
    this.prisma.affiliate.findUnique({ where: { id: payout.affiliateId }, include: { user: true } }).then((aff) => {
      if (!aff) return
      const amount = Number(payout.amount).toFixed(2)
      const currency = payout.currency ?? 'USD'
      this.notifications.notifyUser(organizationId, aff.userId, {
        type: 'payout.sent',
        title: `Payout sent — ${amount} ${currency}`,
        body: `Your payout via ${payout.method} has been processed.`,
        data: { payoutId: payout.id, amount, currency, method: payout.method, reference: reference ?? undefined },
      }).catch(() => {})
      if (!aff.user?.email) return
      this.prisma.organization.findUnique({ where: { id: organizationId } }).then((org) => {
        this.mail.send({
          to: aff.user!.email!,
          ...T.payoutSent({
            orgName: org?.name ?? 'Us',
            firstName: aff.user!.fullName?.split(' ')[0] ?? 'there',
            amount: Number(payout.amount).toFixed(2),
            currency: payout.currency ?? 'USD',
            method: payout.method,
            reference: reference ?? undefined,
            portalUrl: (process.env.APP_URL ?? 'http://localhost:3000') + '/portal/payouts',
            settings: org?.settings ?? null,
          }),
        })
      })
    }).catch(() => {})
  }

  /**
   * Admin: automatically process an approved payout through its provider
   * (Stripe / Wise). Non-automated methods return `processing` for manual settlement.
   * approved -> processing -> paid | failed
   */
  async process(id: string, organizationId: string) {
    const payout = await this.prisma.payout.findFirst({
      where: { id, organizationId },
      include: { items: true },
    })
    if (!payout) throw new NotFoundException('Payout not found')
    if (payout.status !== 'approved')
      throw new BadRequestException(`Only approved payouts can be processed (current: ${payout.status})`)

    // Lock into processing so it can't be double-sent.
    await this.prisma.payout.update({ where: { id }, data: { status: 'processing' } })

    const destination = await this.resolveDestination(payout.affiliateId, payout.method)
    const result = await this.providers.send(payout.method, {
      payoutId: payout.id,
      amount: Number(payout.amount),
      currency: payout.currency ?? 'USD',
      destination,
      memo: `Affiliate payout`,
    })

    if (result.status === 'failed') {
      await this.prisma.payout.update({ where: { id }, data: { status: 'failed' } })
      await this.audit.log({ organizationId, action: 'payout.process_failed', resourceType: 'payout', resourceId: id, newValue: { error: result.error } }).catch(() => {})
      throw new BadRequestException(`Payout failed: ${result.error ?? 'provider error'}`)
    }

    if (result.status === 'paid') {
      await this.settlePaid(organizationId, payout, result.reference)
      return { id, status: 'paid', reference: result.reference, provider: this.providers.forMethod(payout.method).method }
    }

    // processing (async settlement or manual rail): keep provider ref for reconciliation.
    await this.prisma.payout.update({ where: { id }, data: { transactionReference: result.reference ?? undefined } })
    return { id, status: 'processing', reference: result.reference, provider: this.providers.forMethod(payout.method).method }
  }

  /** Admin: list all payouts in org, optionally filtered by status. */
  async list(organizationId: string, status?: string) {
    return this.prisma.payout.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        affiliate: { select: { affiliateCode: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  /** Admin: get single payout with all items. */
  async findOne(id: string, organizationId: string) {
    const payout = await this.prisma.payout.findFirst({
      where: { id, organizationId },
      include: {
        affiliate: { select: { affiliateCode: true, referralSlug: true } },
        items: { include: { commission: true } },
      },
    })
    if (!payout) throw new NotFoundException('Payout not found')
    return payout
  }

  /**
   * Admin: create a payout batch from all payable commissions of an affiliate.
   * FK is Commission.payoutItemId -> PayoutItem.id so we:
   *   1. Create payout + blank items (one per commission)
   *   2. Update each commission.payoutItemId to the created item id
   */
  async createBatch(organizationId: string, dto: CreatePayoutBatchDto) {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: { id: dto.affiliateId, organizationId },
    })
    if (!affiliate) throw new NotFoundException('Affiliate not found')

    const currency = dto.currency ?? 'USD'
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateId: dto.affiliateId, status: 'payable', currency, payoutItemId: null },
    })
    if (commissions.length === 0)
      throw new BadRequestException('No payable commissions found for this affiliate')

    const total = commissions.reduce((s, c) => s + Number(c.amount), 0)

    // Create payout + one PayoutItem per commission
    const payout = await this.prisma.payout.create({
      data: {
        organizationId,
        affiliateId: dto.affiliateId,
        amount: total,
        currency,
        method: dto.method,
        status: 'requested',
        items: { create: commissions.map((c) => ({ amount: c.amount })) },
      },
      include: {
        items: true,
        affiliate: { select: { affiliateCode: true } },
        _count: { select: { items: true } },
      },
    })

    // Link each commission to its payout item by index
    await Promise.all(
      commissions.map((c, i) =>
        this.prisma.commission.update({
          where: { id: c.id },
          data: { payoutItemId: payout.items[i].id },
        }),
      ),
    )

    return payout
  }

  /** Admin: approve a payout (requested -> approved). */
  async approve(id: string, organizationId: string) {
    const payout = await this.prisma.payout.findFirst({ where: { id, organizationId } })
    if (!payout) throw new NotFoundException('Payout not found')
    if (payout.status !== 'requested')
      throw new BadRequestException(`Cannot approve payout in status ${payout.status}`)
    const updated = await this.prisma.payout.update({ where: { id }, data: { status: 'approved' } })
    await this.audit.log({ organizationId, action: 'payout.approve', resourceType: 'payout', resourceId: id, oldValue: { status: 'requested' }, newValue: { status: 'approved' } }).catch(() => {})
    return updated
  }

  /**
   * Admin: manually mark a payout as paid (for non-automated rails or reconciliation).
   * Accepts approved OR processing (e.g. a Wise transfer confirmed out-of-band).
   */
  async markPaid(id: string, organizationId: string, dto: MarkPaidDto) {
    const payout = await this.prisma.payout.findFirst({
      where: { id, organizationId },
      include: { items: true },
    })
    if (!payout) throw new NotFoundException('Payout not found')
    if (!['approved', 'processing'].includes(payout.status))
      throw new BadRequestException(`Cannot mark paid a payout in status ${payout.status}`)

    await this.settlePaid(organizationId, payout, dto.transactionReference)
    return { id, status: 'paid' }
  }

  /** Admin: mark a payout as failed. */
  async fail(id: string, organizationId: string) {
    const payout = await this.prisma.payout.findFirst({ where: { id, organizationId } })
    if (!payout) throw new NotFoundException('Payout not found')
    if (!['requested', 'approved'].includes(payout.status))
      throw new BadRequestException(`Cannot fail a payout in status ${payout.status}`)
    return this.prisma.payout.update({ where: { id }, data: { status: 'failed' } })
  }

  // Portal: affiliate self-service

  /** Affiliate: list their own payouts. */
  async affiliateList(affiliateId: string) {
    return this.prisma.payout.findMany({
      where: { affiliateId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  /** Affiliate: request a payout from payable commissions. */
  async requestPayout(affiliateId: string, organizationId: string, method: string, currency = 'USD') {
    await this.tax.assertPayoutAllowed(organizationId, affiliateId)
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateId, status: 'payable', currency, payoutItemId: null },
    })
    if (commissions.length === 0)
      throw new BadRequestException('No payable commissions available')

    const total = commissions.reduce((s, c) => s + Number(c.amount), 0)
    const payout = await this.prisma.payout.create({
      data: {
        organizationId,
        affiliateId,
        amount: total,
        currency,
        method: method as any,
        status: 'requested',
        items: { create: commissions.map((c) => ({ amount: c.amount })) },
      },
      include: { items: true },
    })

    await Promise.all(
      commissions.map((c, i) =>
        this.prisma.commission.update({
          where: { id: c.id },
          data: { payoutItemId: payout.items[i].id },
        }),
      ),
    )
    return { id: payout.id, amount: total, currency, status: 'requested' }
  }

  // Payout Method Records

  async listPayoutMethods(affiliateId: string) {
    return this.prisma.payoutMethodRecord.findMany({
      where: { affiliateId },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async addPayoutMethod(affiliateId: string, method: string, details?: Record<string, unknown>) {
    const detailsEnc = details ? Buffer.from(JSON.stringify(details)) : undefined
    return this.prisma.payoutMethodRecord.create({
      data: { affiliateId, method: method as any, detailsEnc, isDefault: false },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async setDefaultPayoutMethod(affiliateId: string, recordId: string) {
    await this.prisma.payoutMethodRecord.updateMany({ where: { affiliateId }, data: { isDefault: false } })
    return this.prisma.payoutMethodRecord.update({
      where: { id: recordId },
      data: { isDefault: true },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async deletePayoutMethod(affiliateId: string, recordId: string) {
    await this.prisma.payoutMethodRecord.deleteMany({ where: { id: recordId, affiliateId } })
    return { deleted: true }
  }
}
