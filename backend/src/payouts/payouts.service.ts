import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
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

  private validatePayoutDetails(method: string, input?: Record<string, unknown>): Record<string, string> {
    const details = input ?? {}
    const string = (key: string, required = false) => {
      const value = typeof details[key] === 'string' ? details[key].trim() : ''
      if (required && !value) throw new BadRequestException(`${key} is required for ${method} payouts`)
      if (value.length > 500) throw new BadRequestException(`${key} is too long`)
      return value
    }
    switch (method) {
      case 'paypal': return { email: string('email', true) }
      case 'stripe': return { accountId: string('accountId', true) }
      case 'wise': return { recipientId: string('recipientId', true) }
      case 'bank':
        return {
          accountHolder: string('accountHolder', true),
          bankName: string('bankName', true),
          accountNumber: string('accountNumber', true),
          routingNumber: string('routingNumber'),
          iban: string('iban'),
          country: string('country', true),
        }
      case 'crypto': return { network: string('network', true), walletAddress: string('walletAddress', true) }
      case 'manual': return { instructions: string('instructions', true) }
      default: throw new BadRequestException('Unsupported payout method')
    }
  }

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
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payout.updateMany({
        where: { id: payout.id, status: { in: ['approved', 'processing'] } },
        data: { status: 'paid', transactionReference: reference ?? undefined },
      })
      if (claimed.count !== 1) throw new BadRequestException('Payout was already settled or changed concurrently')
      await tx.commission.updateMany({
        where: { payoutItemId: { in: itemIds }, status: 'locked' },
        data: { status: 'paid' },
      })
      await tx.affiliateLedgerEntry.create({
        data: {
          organizationId,
          affiliateId: payout.affiliateId,
          payoutId: payout.id,
          type: 'payout_paid',
          balanceDelta: 0,
          lifetimeDelta: 0,
          currency: payout.currency ?? 'USD',
          idempotencyKey: `payout-paid:${payout.id}`,
          description: 'Reserved payout settled by provider',
          metadata: reference ? { reference } : undefined,
        },
      })
    })
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

  /** Release a failed/rejected reservation exactly once. */
  private async releasePayout(
    organizationId: string,
    payout: { id: string; affiliateId: string; amount: any; currency: string | null; status: string; items: { id: string }[] },
    status: 'failed' | 'rejected',
  ) {
    const itemIds = payout.items.map((item) => item.id)
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.payout.updateMany({
        where: { id: payout.id, status: { in: ['requested', 'approved', 'processing'] } },
        data: { status },
      })
      if (changed.count !== 1) {
        const current = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } })
        return current
      }
      await tx.commission.updateMany({
        where: { payoutItemId: { in: itemIds }, status: 'locked' },
        data: { status: 'payable', payoutItemId: null },
      })
      await tx.affiliate.update({
        where: { id: payout.affiliateId },
        data: { availableBalance: { increment: new Prisma.Decimal(payout.amount) } },
      })
      await tx.affiliateBalance.upsert({
        where: { affiliateId_currency: { affiliateId: payout.affiliateId, currency: payout.currency ?? 'USD' } },
        create: {
          organizationId,
          affiliateId: payout.affiliateId,
          currency: payout.currency ?? 'USD',
          available: payout.amount,
          lifetime: 0,
        },
        update: { available: { increment: new Prisma.Decimal(payout.amount) } },
      })
      await tx.affiliateLedgerEntry.create({
        data: {
          organizationId,
          affiliateId: payout.affiliateId,
          payoutId: payout.id,
          type: 'payout_released',
          balanceDelta: payout.amount,
          lifetimeDelta: 0,
          currency: payout.currency ?? 'USD',
          idempotencyKey: `payout-released:${payout.id}`,
          description: `Payout reservation ${status}`,
        },
      })
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id } })
    })
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

    // Compare-and-swap into processing so two admins/workers cannot send the
    // same payout. Provider idempotency is defence-in-depth, not the lock.
    const claimed = await this.prisma.payout.updateMany({
      where: { id, organizationId, status: 'approved' },
      data: { status: 'processing' },
    })
    if (claimed.count !== 1) throw new BadRequestException('Payout is already being processed')

    const destination = await this.resolveDestination(payout.affiliateId, payout.method)
    const result = await this.providers.send(payout.method, {
      payoutId: payout.id,
      amount: Number(payout.amount),
      currency: payout.currency ?? 'USD',
      destination,
      memo: `Affiliate payout`,
    })

    if (result.status === 'failed') {
      await this.releasePayout(organizationId, { ...payout, status: 'processing' }, 'failed')
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
    const validStatuses = new Set(['requested', 'approved', 'processing', 'paid', 'failed', 'rejected'])
    if (status && !validStatuses.has(status)) throw new BadRequestException('Invalid payout status')
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
    await this.tax.assertPayoutAllowed(organizationId, dto.affiliateId)
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!organization) throw new NotFoundException('Organization not found')
    return this.createClaimedPayout(organizationId, dto.affiliateId, dto.method, dto.currency ?? organization.defaultCurrency)
  }

  private async createClaimedPayout(
    organizationId: string,
    affiliateId: string,
    method: string,
    currency: string,
  ) {
    const normalizedCurrency = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new BadRequestException('Currency must be a three-letter ISO code')

    return this.prisma.$transaction(async (tx) => {
      const affiliate = await tx.affiliate.findFirst({ where: { id: affiliateId, organizationId, status: 'approved' } })
      if (!affiliate) throw new NotFoundException('Active affiliate not found')
      const destination = await tx.payoutMethodRecord.findFirst({
        where: { affiliateId, method: method as any },
        orderBy: { isDefault: 'desc' },
      })
      if (!destination) throw new BadRequestException('Add payout destination details before requesting this method')

      const commissions = await tx.commission.findMany({
        where: { affiliateId, status: 'payable', currency: normalizedCurrency, payoutItemId: null },
        include: { adjustments: true },
        orderBy: { createdAt: 'asc' },
      })
      const claimable = commissions
        .map((commission) => ({
          commission,
          amount: Prisma.Decimal.max(
            new Prisma.Decimal(commission.amount).add(
              commission.adjustments.reduce((sum, adjustment) => sum.add(adjustment.delta), new Prisma.Decimal(0)),
            ),
            new Prisma.Decimal(0),
          ).toDecimalPlaces(4),
        }))
        .filter((item) => item.amount.gt(0))
      if (!claimable.length) throw new BadRequestException('No payable commissions found for this affiliate')

      const total = claimable.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0)).toDecimalPlaces(4)
      const balanceClaim = await tx.affiliateBalance.updateMany({
        where: { affiliateId, organizationId, currency: normalizedCurrency, available: { gte: total } },
        data: { available: { decrement: total } },
      })
      if (balanceClaim.count !== 1) {
        throw new BadRequestException('Available balance is lower than the payable commission total')
      }
      // Deprecated aggregate cache retained for v5 clients; v6 reads the
      // currency-specific AffiliateBalance rows.
      await tx.affiliate.update({
        where: { id: affiliateId },
        data: { availableBalance: { decrement: total } },
      })

      const payout = await tx.payout.create({
        data: {
          organizationId,
          affiliateId,
          amount: total,
          currency: normalizedCurrency,
          method: method as any,
          status: 'requested',
        },
      })
      for (const item of claimable) {
        const payoutItem = await tx.payoutItem.create({
          data: { payoutId: payout.id, amount: item.amount },
        })
        const claimed = await tx.commission.updateMany({
          where: { id: item.commission.id, status: 'payable', payoutItemId: null },
          data: { status: 'locked', payoutItemId: payoutItem.id },
        })
        if (claimed.count !== 1) throw new BadRequestException('A commission was claimed concurrently; retry')
      }
      await tx.affiliateLedgerEntry.create({
        data: {
          organizationId,
          affiliateId,
          payoutId: payout.id,
          type: 'payout_reserved',
          balanceDelta: total.neg(),
          lifetimeDelta: 0,
          currency: normalizedCurrency,
          idempotencyKey: `payout-reserved:${payout.id}`,
          description: 'Payable commissions reserved for payout',
        },
      })
      return tx.payout.findUniqueOrThrow({
        where: { id: payout.id },
        include: {
          items: true,
          affiliate: { select: { affiliateCode: true } },
          _count: { select: { items: true } },
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  /** Admin: approve a payout (requested -> approved). */
  async approve(id: string, organizationId: string) {
    const payout = await this.prisma.payout.findFirst({ where: { id, organizationId } })
    if (!payout) throw new NotFoundException('Payout not found')
    if (payout.status !== 'requested')
      throw new BadRequestException(`Cannot approve payout in status ${payout.status}`)
    const claimed = await this.prisma.payout.updateMany({
      where: { id, organizationId, status: 'requested' },
      data: { status: 'approved' },
    })
    if (claimed.count !== 1) throw new BadRequestException('Payout changed concurrently')
    const updated = await this.prisma.payout.findUniqueOrThrow({ where: { id } })
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
    const payout = await this.prisma.payout.findFirst({ where: { id, organizationId }, include: { items: true } })
    if (!payout) throw new NotFoundException('Payout not found')
    if (!['requested', 'approved'].includes(payout.status))
      throw new BadRequestException(`Cannot fail a payout in status ${payout.status}`)
    return this.releasePayout(organizationId, payout, 'failed')
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
  async requestPayout(affiliateId: string, organizationId: string, method: string, currency?: string) {
    await this.tax.assertPayoutAllowed(organizationId, affiliateId)
    const payoutMethod = await this.prisma.payoutMethodRecord.findFirst({
      where: { affiliateId, method: method as any },
      select: { id: true },
    })
    if (!payoutMethod) {
      throw new BadRequestException(`Add and save a ${method} payout method before requesting a payout`)
    }
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!organization) throw new NotFoundException('Organization not found')
    const payout = await this.createClaimedPayout(
      organizationId,
      affiliateId,
      method,
      currency ?? organization.defaultCurrency,
    )
    return { id: payout.id, amount: Number(payout.amount), currency: payout.currency, status: payout.status }
  }

  // Payout Method Records

  async listPayoutMethods(affiliateId: string) {
    return this.prisma.payoutMethodRecord.findMany({
      where: { affiliateId },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async addPayoutMethod(affiliateId: string, method: string, details?: Record<string, unknown>) {
    const safeDetails = this.validatePayoutDetails(method, details)
    const detailsEnc = this.crypto.encrypt(JSON.stringify(safeDetails))
    const existing = await this.prisma.payoutMethodRecord.findFirst({ where: { affiliateId, method: method as any } })
    if (existing) {
      return this.prisma.payoutMethodRecord.update({
        where: { id: existing.id },
        data: { detailsEnc },
        select: { id: true, method: true, isDefault: true },
      })
    }
    const existingCount = await this.prisma.payoutMethodRecord.count({ where: { affiliateId } })
    return this.prisma.payoutMethodRecord.create({
      data: { affiliateId, method: method as any, detailsEnc, isDefault: existingCount === 0 },
      select: { id: true, method: true, isDefault: true },
    })
  }

  async setDefaultPayoutMethod(affiliateId: string, recordId: string) {
    const record = await this.prisma.payoutMethodRecord.findFirst({ where: { id: recordId, affiliateId } })
    if (!record) throw new NotFoundException('Payout method not found')
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
