import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Prisma, type PaymentGatewayConfig } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { GatewayFactory } from './gateways/gateway.factory'
import { GatewayError, LineItem, NormalizedEvent, ProviderName } from './gateways/gateway.types'
import {
  ChargeTenantDto,
  CreatePayoutDto,
  StartSetupDto,
  StartSubscriptionDto,
  UpsertGatewayConfigDto,
} from './dto/billing.dto'

/**
 * Platform billing orchestrator. Charges tenants (clients) for their SaaS plan
 * through a pluggable gateway (Whop = Stripe-like, Swich = Pakistani). Handles
 * saved cards, trials set on the plan, tax added on top of the client, hosted
 * invoices/receipts, subscriptions, payouts, and inbound webhooks.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger('BillingService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly factory: GatewayFactory,
  ) {}

  // ── Config CRUD ───────────────────────────────────────────────────────
  async listConfigs(scope: 'platform' | 'tenant' = 'platform', organizationId?: string) {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      where: { scope, ...(organizationId ? { organizationId } : {}) },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
    return rows.map((r) => this.publicConfig(r))
  }

  async createConfig(dto: UpsertGatewayConfigDto) {
    const scope = dto.scope ?? 'platform'
    if (scope === 'tenant' && !dto.organizationId) {
      throw new BadRequestException('organizationId is required for tenant-scoped gateways')
    }
    const created = await this.prisma.paymentGatewayConfig.create({
      data: {
        scope,
        organizationId: scope === 'tenant' ? dto.organizationId! : null,
        provider: dto.provider,
        label: dto.label ?? null,
        companyId: dto.companyId ?? null,
        apiKeyEnc: dto.apiKey ? this.crypto.encrypt(dto.apiKey) : null,
        webhookSecretEnc: dto.webhookSecret ? this.crypto.encrypt(dto.webhookSecret) : null,
        isLive: dto.isLive ?? false,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        taxEnabled: dto.taxEnabled ?? false,
        taxPercent: dto.taxPercent ?? 0,
        taxLabel: dto.taxLabel ?? 'Tax',
        taxInclusive: dto.taxInclusive ?? false,
      },
    })
    if (created.isDefault) await this.clearOtherDefaults(created)
    return this.withWebhookUrl(created)
  }

  async updateConfig(id: string, dto: UpsertGatewayConfigDto) {
    const existing = await this.getConfigRow(id)
    const updated = await this.prisma.paymentGatewayConfig.update({
      where: { id },
      data: {
        label: dto.label ?? existing.label,
        companyId: dto.companyId ?? existing.companyId,
        // Only replace secrets when a new plaintext value is supplied.
        apiKeyEnc: dto.apiKey ? this.crypto.encrypt(dto.apiKey) : existing.apiKeyEnc,
        webhookSecretEnc: dto.webhookSecret ? this.crypto.encrypt(dto.webhookSecret) : existing.webhookSecretEnc,
        isLive: dto.isLive ?? existing.isLive,
        isActive: dto.isActive ?? existing.isActive,
        isDefault: dto.isDefault ?? existing.isDefault,
        taxEnabled: dto.taxEnabled ?? existing.taxEnabled,
        taxPercent: dto.taxPercent ?? existing.taxPercent,
        taxLabel: dto.taxLabel ?? existing.taxLabel,
        taxInclusive: dto.taxInclusive ?? existing.taxInclusive,
      },
    })
    if (updated.isDefault) await this.clearOtherDefaults(updated)
    return this.withWebhookUrl(updated)
  }

  async getConfig(id: string) {
    return this.withWebhookUrl(await this.getConfigRow(id))
  }

  async deleteConfig(id: string) {
    await this.getConfigRow(id)
    await this.prisma.paymentGatewayConfig.delete({ where: { id } })
    return { deleted: true }
  }

  // ── Tenant self-service gateways (scope = 'tenant') ─────────────────────
  // Merchants configure and use their OWN Whop / Swich accounts, fully
  // isolated from the platform gateways. Primary use: paying affiliate
  // payouts (Swich supports disbursements).

  listTenantConfigs(organizationId: string) {
    return this.listConfigs('tenant', organizationId)
  }

  createTenantConfig(organizationId: string, dto: UpsertGatewayConfigDto) {
    return this.createConfig({ ...dto, scope: 'tenant', organizationId })
  }

  async getTenantConfig(organizationId: string, id: string) {
    return this.withWebhookUrl(await this.getTenantConfigRow(organizationId, id))
  }

  async updateTenantConfig(organizationId: string, id: string, dto: UpsertGatewayConfigDto) {
    await this.getTenantConfigRow(organizationId, id)
    // scope + organizationId stay immutable for tenant configs.
    return this.updateConfig(id, { ...dto, scope: 'tenant', organizationId })
  }

  async deleteTenantConfig(organizationId: string, id: string) {
    await this.getTenantConfigRow(organizationId, id)
    await this.prisma.paymentGatewayConfig.delete({ where: { id } })
    return { deleted: true }
  }

  /** Send an affiliate / client payout through one of the tenant's own gateways. */
  async createTenantPayout(organizationId: string, dto: CreatePayoutDto) {
    const config = await this.getTenantConfigRow(organizationId, dto.configId)
    this.assertUsableConfig(config, 'tenant')
    const gateway = this.factory.build(config)
    if (!gateway.supportsPayouts()) throw new BadRequestException(`${config.provider} does not support payouts`)
    this.assertPayoutDestination(dto.destination)
    return gateway.createPayout({
      amountCents: dto.amountCents,
      currency: (dto.currency || 'PKR').toUpperCase(),
      destination: dto.destination, reference: dto.reference, purpose: dto.purpose,
    })
  }

  private async getTenantConfigRow(organizationId: string, id: string): Promise<PaymentGatewayConfig> {
    const row = await this.getConfigRow(id)
    if (row.scope !== 'tenant' || row.organizationId !== organizationId) {
      throw new NotFoundException('Gateway config not found')
    }
    return row
  }

  /** The webhook URL a merchant pastes into the Whop / Swich dashboard. */
  webhookUrl(configId: string, provider: ProviderName): string {
    const base = (process.env.APP_PUBLIC_URL || 'https://affiliate.mentoringhub.online').replace(/\/+$/, '')
    const prefix = process.env.API_PREFIX || 'v1'
    return `${base}/${prefix}/billing/webhooks/${provider}/${configId}`
  }

  // ── Save card (setup) ──────────────────────────────────────────────────
  async startSetup(organizationId: string, dto: StartSetupDto) {
    const org = await this.getOrg(organizationId)
    const config = await this.pickConfig(dto.configId, dto.provider)
    const gateway = this.factory.build(config)
    const session = await gateway.createSetupSession({
      email: org.email ?? undefined,
      name: org.name,
      returnUrl: this.validatedReturnUrl(dto.returnUrl),
      metadata: { organizationId, configId: config.id },
    })
    // Ensure a BillingCustomer shell exists to attach the card later (via webhook).
    await this.prisma.billingCustomer.upsert({
      where: { organizationId_configId: { organizationId, configId: config.id } },
      create: { organizationId, configId: config.id, provider: config.provider, email: org.email ?? null },
      update: {},
    })
    return { url: session.url, sessionId: session.id, provider: config.provider }
  }

  // ── Off-session charge (+ tax) with hosted invoice/receipt ──────────────────
  async chargeTenant(
    organizationId: string,
    dto: ChargeTenantDto,
    cycle?: { idempotencyKey: string; periodStart: Date; periodEnd: Date },
  ) {
    const org = await this.getOrg(organizationId)
    const { config, customer } = await this.requireCustomer(organizationId)
    const gateway = this.factory.build(config)
    const currency = (dto.currency || org.defaultCurrency || 'USD').toUpperCase()

    const subtotal = dto.amountCents
    const tax = this.computeTaxCents(subtotal, config)
    const total = subtotal + tax
    const lineItems = this.buildLineItems(dto.description ?? 'Subscription charge', subtotal, tax, config)

    // A billing-cycle invoice has a deterministic unique key. If the worker
    // crashes after the provider accepted a request, the same local invoice
    // and provider Idempotency-Key are reused instead of charging twice.
    let invoice = cycle
      ? await this.prisma.billingInvoice.findUnique({ where: { idempotencyKey: cycle.idempotencyKey } })
      : null
    if (invoice?.providerInvoiceId) {
      return {
        invoiceId: invoice.id,
        id: invoice.providerInvoiceId,
        number: invoice.number,
        status: invoice.status,
        hostedUrl: invoice.hostedUrl,
        pdfUrl: invoice.pdfUrl,
        provider: invoice.provider,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        duplicate: true,
      }
    }
    if (!invoice) {
      try {
        invoice = await this.prisma.billingInvoice.create({
          data: {
            organizationId, configId: config.id, customerId: customer.id, provider: config.provider,
            status: 'open', currency, subtotalCents: subtotal, taxCents: tax, totalCents: total,
            lineItems: lineItems as any, metadata: { description: dto.description ?? null } as any,
            idempotencyKey: cycle?.idempotencyKey,
            periodStart: cycle?.periodStart,
            periodEnd: cycle?.periodEnd,
          },
        })
      } catch (error) {
        if (!cycle || !this.isUniqueConflict(error)) throw error
        invoice = await this.prisma.billingInvoice.findUnique({ where: { idempotencyKey: cycle.idempotencyKey } })
        if (!invoice) throw error
      }
    }

    const result = await gateway.createInvoice({
      memberOrCustomerId: customer.providerMemberId ?? customer.providerCustomerId ?? undefined,
      paymentMethodId: customer.defaultPaymentMethodId ?? undefined,
      currency, lineItems, subtotalCents: subtotal, taxCents: tax, totalCents: total,
      description: dto.description ?? undefined,
      autoCharge: dto.autoCharge ?? true,
      metadata: { organizationId, invoiceId: invoice.id },
      idempotencyKey: cycle?.idempotencyKey,
    })

    await this.prisma.billingInvoice.update({
      where: { id: invoice.id },
      data: {
        providerInvoiceId: result.id, number: result.number ?? undefined,
        hostedUrl: result.hostedUrl ?? undefined, pdfUrl: result.pdfUrl ?? undefined,
        status: result.status === 'paid' ? 'paid' : 'open',
        paidAt: result.status === 'paid' ? new Date() : undefined,
      },
    })
    return { invoiceId: invoice.id, ...result, subtotalCents: subtotal, taxCents: tax, totalCents: total }
  }

  // ── Subscriptions with plan trial ───────────────────────────────────────
  async startSubscription(organizationId: string, dto: StartSubscriptionDto) {
    await this.getOrg(organizationId)
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } })
    if (!plan) throw new NotFoundException('Plan not found')
    const trialDays = dto.trialDaysOverride ?? plan.trialDays ?? 0
    const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null

    await this.prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId, planId: plan.id,
        status: trialDays > 0 ? 'trialing' : 'active',
        trialEndsAt,
        currentPeriodEnd: trialEndsAt ?? this.nextPeriodEnd(plan.interval),
      },
      update: {
        planId: plan.id, status: trialDays > 0 ? 'trialing' : 'active',
        trialEndsAt, currentPeriodEnd: trialEndsAt ?? this.nextPeriodEnd(plan.interval), pastDueSince: null,
      },
    })
    await this.prisma.organization.update({ where: { id: organizationId }, data: { plan: plan.key } })

    // Collect a card up-front (charged automatically when the trial ends).
    const setup = await this.startSetup(organizationId, { configId: dto.configId, returnUrl: dto.returnUrl })
    return { planKey: plan.key, trialDays, trialEndsAt, setupUrl: setup.url, provider: setup.provider }
  }

  /**
   * Billing cycle worker: charge every subscription whose trial/period has
   * ended. Intended to be invoked by a daily cron / queue job.
   */
  async runBillingCycle(now = new Date()) {
    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['trialing', 'active', 'past_due'] },
        currentPeriodEnd: { lte: now },
      },
      include: { plan: true },
    })
    const results: Array<{ organizationId: string; ok: boolean; skipped?: boolean; error?: string }> = []
    const staleLock = new Date(now.getTime() - 15 * 60_000)
    for (const sub of due) {
      const lockToken = randomUUID()
      const claimed = await this.prisma.subscription.updateMany({
        where: {
          organizationId: sub.organizationId,
          status: { in: ['trialing', 'active', 'past_due'] },
          currentPeriodEnd: sub.currentPeriodEnd,
          OR: [{ billingLockAt: null }, { billingLockAt: { lt: staleLock } }],
        },
        data: { billingLockAt: now, billingLockToken: lockToken },
      })
      if (claimed.count !== 1) {
        results.push({ organizationId: sub.organizationId, ok: true, skipped: true })
        continue
      }
      const periodStart = sub.currentPeriodEnd ?? now
      const periodEnd = this.nextPeriodEnd(sub.plan.interval, periodStart)
      try {
        let paymentStatus = 'paid'
        if (sub.plan.priceCents > 0) {
          const invoice = await this.chargeTenant(sub.organizationId, {
            amountCents: sub.plan.priceCents,
            currency: sub.plan.currency,
            description: `${sub.plan.name} (${sub.plan.interval}ly)`,
            recurring: true, autoCharge: true,
          }, {
            idempotencyKey: `subscription:${sub.id}:${periodStart.toISOString()}`,
            periodStart,
            periodEnd,
          })
          paymentStatus = invoice.status
        }
        const paid = paymentStatus === 'paid'
        if (!paid) {
          await this.prisma.subscription.updateMany({
            where: { organizationId: sub.organizationId, billingLockToken: lockToken, pastDueSince: null },
            data: { pastDueSince: now },
          })
        }
        await this.prisma.subscription.updateMany({
          where: { organizationId: sub.organizationId, billingLockToken: lockToken },
          data: {
            status: paid ? 'active' : 'past_due',
            ...(paid ? { currentPeriodEnd: periodEnd } : {}),
            ...(paid ? { pastDueSince: null } : {}),
            billingLockAt: null,
            billingLockToken: null,
          },
        })
        results.push({
          organizationId: sub.organizationId,
          ok: paid,
          ...(paid ? {} : { error: `Payment is ${paymentStatus}; access remains in the configured past-due grace period` }),
        })
      } catch (e: any) {
        await this.prisma.subscription.updateMany({
          where: { organizationId: sub.organizationId, billingLockToken: lockToken, pastDueSince: null },
          data: { pastDueSince: now },
        })
        await this.prisma.subscription.updateMany({
          where: { organizationId: sub.organizationId, billingLockToken: lockToken },
          data: { status: 'past_due', billingLockAt: null, billingLockToken: null },
        })
        results.push({ organizationId: sub.organizationId, ok: false, error: e?.message })
      }
    }
    return { processed: due.length, results }
  }

  // ── Invoices ─────────────────────────────────────────────────────────
  listInvoices(organizationId?: string) {
    return this.prisma.billingInvoice.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: 'desc' }, take: 200,
    })
  }

  // ── Payouts ───────────────────────────────────────────────────────
  async createPayout(dto: CreatePayoutDto) {
    const config = await this.getConfigRow(dto.configId)
    this.assertUsableConfig(config, 'platform')
    const gateway = this.factory.build(config)
    if (!gateway.supportsPayouts()) throw new BadRequestException(`${config.provider} does not support payouts`)
    this.assertPayoutDestination(dto.destination)
    return gateway.createPayout({
      amountCents: dto.amountCents,
      currency: (dto.currency || 'PKR').toUpperCase(),
      destination: dto.destination, reference: dto.reference, purpose: dto.purpose,
    })
  }

  // ── Webhooks ──────────────────────────────────────────────────────
  async handleWebhook(provider: ProviderName, configId: string, rawBody: string, headers: Record<string, any>) {
    if (!['whop', 'swich'].includes(provider)) throw new BadRequestException('Unsupported billing provider')
    if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > 256 * 1024) {
      throw new BadRequestException('Webhook body is empty or exceeds 256 KiB')
    }
    const config = await this.getConfigRow(configId)
    if (config.provider !== provider) throw new BadRequestException('Provider/config mismatch')
    this.assertUsableConfig(config)
    const gateway = this.factory.build(config)
    let evt: NormalizedEvent
    try {
      evt = gateway.verifyAndParseWebhook({ rawBody, headers })
    } catch (error) {
      if (error instanceof GatewayError) throw new HttpException(error.message, error.status ?? 400)
      throw error
    }
    if (!evt.id?.trim() || evt.id.length > 255) throw new BadRequestException('Webhook event id is missing or invalid')
    if (!evt.type?.trim() || evt.type.length > 200) throw new BadRequestException('Webhook event type is missing or invalid')

    // Insert-first idempotency closes the find-then-create race. A failed event
    // may be retried; processed/ignored/in-flight events are acknowledged.
    let record: any
    try {
      record = await this.prisma.gatewayEvent.create({
        data: { provider, eventId: evt.id, type: evt.type, payload: evt.raw as any, status: 'received' },
      })
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error
      const existing = await this.prisma.gatewayEvent.findUnique({
        where: { provider_eventId: { provider, eventId: evt.id } },
      })
      if (!existing || existing.status !== 'failed') return { ok: true, duplicate: true }
      const reclaimed = await this.prisma.gatewayEvent.updateMany({
        where: { id: existing.id, status: 'failed' },
        data: { status: 'received', error: null },
      })
      if (reclaimed.count !== 1) return { ok: true, duplicate: true }
      record = existing
    }
    try {
      const handled = await this.processEvent(config, evt)
      await this.prisma.gatewayEvent.update({
        where: { id: record.id },
        data: { status: handled ? 'processed' : 'ignored', processedAt: new Date() },
      })
    } catch (e: any) {
      await this.prisma.gatewayEvent.update({ where: { id: record.id }, data: { status: 'failed', error: e?.message?.slice(0, 500) } })
      this.log.error(`Webhook ${evt.type} processing failed: ${e?.message}`)
      throw new ServiceUnavailableException('Webhook was verified but could not be processed; retry later')
    }
    return { ok: true }
  }

  private async processEvent(config: PaymentGatewayConfig, evt: NormalizedEvent): Promise<boolean> {
    const data = evt.data ?? {}
    switch (evt.type) {
      case 'setup_intent.succeeded': {
        // Card saved → attach payment method to the tenant's BillingCustomer.
        const organizationId = data.metadata?.organizationId ?? data.checkout_configuration?.metadata?.organizationId
        if (!organizationId) return false
        this.assertEventOrganization(config, organizationId)
        const pm = data.payment_method ?? {}
        const memberId = data.member?.id ?? data.member_id
        const updated = await this.prisma.billingCustomer.updateMany({
          where: { organizationId, configId: config.id },
          data: {
            providerMemberId: memberId ?? undefined,
            defaultPaymentMethodId: pm.id ?? undefined,
            cardBrand: pm.card?.brand ?? pm.brand ?? undefined,
            cardLast4: pm.card?.last4 ?? pm.last4 ?? undefined,
            cardExpMonth: pm.card?.exp_month ?? undefined,
            cardExpYear: pm.card?.exp_year ?? undefined,
          },
        })
        if (updated.count !== 1) throw new BadRequestException('Billing customer setup session was not found')
        return true
      }
      case 'payment.succeeded':
      case 'invoice.paid': {
        const invoice = await this.resolveEventInvoice(config, evt)
        if (!invoice) return false
        await this.prisma.$transaction(async (tx) => {
          await tx.billingInvoice.updateMany({
            where: { id: invoice.id, configId: config.id },
            data: {
              status: 'paid',
              paidAt: new Date(),
              providerPaymentId: evt.type === 'payment.succeeded' ? data.id ?? undefined : undefined,
            },
          })
          if (invoice.periodStart && invoice.periodEnd) {
            await tx.subscription.updateMany({
              where: {
                organizationId: invoice.organizationId,
                status: { in: ['trialing', 'active', 'past_due'] },
                currentPeriodEnd: { lte: invoice.periodStart },
              },
              data: {
                status: 'active',
                currentPeriodEnd: invoice.periodEnd,
                pastDueSince: null,
                billingLockAt: null,
                billingLockToken: null,
              },
            })
          }
        })
        return true
      }
      case 'payment.failed':
      case 'invoice.past_due':
      case 'invoice.marked_uncollectible': {
        const invoice = await this.resolveEventInvoice(config, evt)
        if (!invoice) return false
        await this.prisma.$transaction([
          this.prisma.billingInvoice.updateMany({
            where: { id: invoice.id, configId: config.id },
            data: {
              status: evt.type === 'invoice.marked_uncollectible' ? 'uncollectible' : 'open',
              providerPaymentId: evt.type === 'payment.failed' ? data.id ?? undefined : undefined,
            },
          }),
          this.prisma.subscription.updateMany({
            where: { organizationId: invoice.organizationId, status: { not: 'canceled' }, pastDueSince: null },
            data: { pastDueSince: new Date() },
          }),
          this.prisma.subscription.updateMany({
            where: { organizationId: invoice.organizationId, status: { not: 'canceled' } },
            data: { status: 'past_due', billingLockAt: null, billingLockToken: null },
          }),
        ])
        return true
      }
      case 'membership.deactivated': {
        const organizationId = data.metadata?.organizationId
        if (!organizationId) return false
        this.assertEventOrganization(config, organizationId)
        await this.prisma.subscription.updateMany({ where: { organizationId }, data: { status: 'canceled' } })
        return true
      }
      default:
        this.log.debug(`Unhandled ${config.provider} event: ${evt.type}`)
        return false
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────
  private computeTaxCents(subtotalCents: number, config: PaymentGatewayConfig): number {
    if (!config.taxEnabled || config.taxPercent <= 0) return 0
    if (config.taxInclusive) return 0 // tax already inside the price
    return Math.round((subtotalCents * config.taxPercent) / 100)
  }

  private buildLineItems(description: string, subtotalCents: number, taxCents: number, config: PaymentGatewayConfig): LineItem[] {
    const items: LineItem[] = [{ description, amountCents: subtotalCents, quantity: 1, kind: 'plan' }]
    if (taxCents > 0) {
      items.push({ description: `${config.taxLabel ?? 'Tax'} (${config.taxPercent}%)`, amountCents: taxCents, quantity: 1, kind: 'tax' })
    }
    return items
  }

  private nextPeriodEnd(interval: 'month' | 'year', from: Date = new Date()): Date {
    const d = new Date(from)
    const originalDay = d.getUTCDate()
    d.setUTCDate(1)
    if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1)
    else d.setUTCMonth(d.getUTCMonth() + 1)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(originalDay, lastDay))
    return d
  }

  private async getConfigRow(id: string): Promise<PaymentGatewayConfig> {
    const row = await this.prisma.paymentGatewayConfig.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Gateway config not found')
    return row
  }

  private async pickConfig(configId?: string, provider?: ProviderName): Promise<PaymentGatewayConfig> {
    if (configId) {
      const row = await this.getConfigRow(configId)
      this.assertUsableConfig(row, 'platform')
      if (provider && row.provider !== provider) throw new BadRequestException('Gateway provider/config mismatch')
      return row
    }
    const row = await this.prisma.paymentGatewayConfig.findFirst({
      where: { scope: 'platform', isActive: true, ...(provider ? { provider } : {}) },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
    if (!row) throw new BadRequestException('No active gateway configured')
    return row
  }

  private async requireCustomer(organizationId: string) {
    const customer = await this.prisma.billingCustomer.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    })
    if (!customer) throw new BadRequestException('No saved payment method for this tenant. Run setup first.')
    const config = await this.getConfigRow(customer.configId)
    this.assertUsableConfig(config, 'platform')
    return { config, customer }
  }

  private assertUsableConfig(config: PaymentGatewayConfig, scope?: 'platform' | 'tenant') {
    if (!config.isActive) throw new BadRequestException('Gateway config is inactive')
    if (scope && config.scope !== scope) throw new NotFoundException('Gateway config not found')
    if (config.scope === 'tenant' && !config.organizationId) {
      throw new BadRequestException('Tenant gateway is missing its organization binding')
    }
  }

  /** Prevent gateway-hosted pages from becoming an arbitrary redirector. */
  private validatedReturnUrl(requested?: string): string | undefined {
    if (!requested) return undefined
    const appUrl = process.env.APP_URL || process.env.APP_PUBLIC_URL
    if (!appUrl) throw new BadRequestException('APP_URL must be configured before using a custom return URL')
    try {
      const target = new URL(requested)
      const application = new URL(appUrl)
      if (target.origin !== application.origin) {
        throw new BadRequestException('Return URL must use the configured application origin')
      }
      return target.toString()
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException('Return URL is invalid')
    }
  }

  private assertPayoutDestination(destination: Record<string, unknown>) {
    let encoded = ''
    try { encoded = JSON.stringify(destination) }
    catch { throw new BadRequestException('Payout destination must be valid JSON') }
    if (!encoded || encoded.length > 8_192 || Object.keys(destination).length > 30) {
      throw new BadRequestException('Payout destination is too large')
    }
  }

  private assertEventOrganization(config: PaymentGatewayConfig, organizationId: string) {
    if (config.scope === 'tenant' && config.organizationId !== organizationId) {
      throw new BadRequestException('Webhook tenant does not match this gateway config')
    }
  }

  private async resolveEventInvoice(config: PaymentGatewayConfig, evt: NormalizedEvent) {
    const data = evt.data ?? {}
    const localId = data.metadata?.invoiceId
    const providerInvoiceId =
      data.invoice_id ??
      data.invoice?.id ??
      (evt.type.startsWith('invoice.') ? data.id : null)
    if (!localId && !providerInvoiceId) return null
    const invoice = await this.prisma.billingInvoice.findFirst({
      where: {
        configId: config.id,
        OR: [
          ...(localId ? [{ id: String(localId) }] : []),
          ...(providerInvoiceId ? [{ providerInvoiceId: String(providerInvoiceId) }] : []),
        ],
      },
    })
    if (invoice) this.assertEventOrganization(config, invoice.organizationId)
    return invoice
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private async getOrg(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { users: { where: { }, take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!org) throw new NotFoundException('Tenant not found')
    return { ...org, email: org.users[0]?.email ?? null }
  }

  private async clearOtherDefaults(config: PaymentGatewayConfig) {
    await this.prisma.paymentGatewayConfig.updateMany({
      where: { scope: config.scope, organizationId: config.organizationId, id: { not: config.id }, isDefault: true },
      data: { isDefault: false },
    })
  }

  /** Strip secrets; expose safe metadata + webhook URL. */
  private publicConfig(r: PaymentGatewayConfig) {
    return {
      id: r.id, scope: r.scope, organizationId: r.organizationId, provider: r.provider,
      label: r.label, companyId: r.companyId,
      hasApiKey: !!r.apiKeyEnc, hasWebhookSecret: !!r.webhookSecretEnc,
      isLive: r.isLive, isActive: r.isActive, isDefault: r.isDefault,
      taxEnabled: r.taxEnabled, taxPercent: r.taxPercent, taxLabel: r.taxLabel, taxInclusive: r.taxInclusive,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
      webhookUrl: this.webhookUrl(r.id, r.provider as ProviderName),
    }
  }

  private withWebhookUrl(r: PaymentGatewayConfig) {
    return this.publicConfig(r)
  }
}
