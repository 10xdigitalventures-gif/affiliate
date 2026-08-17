import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { PaymentGatewayConfig } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { GatewayFactory } from './gateways/gateway.factory'
import { LineItem, NormalizedEvent, ProviderName } from './gateways/gateway.types'
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

  // ── Config CRUD ──────────────────────────────────────────────────────────────
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

  // ── Tenant self-service gateways ─────────────────────────────────────────────
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
    return this.updateConfig(id, { ...dto, scope: 'tenant', organizationId })
  }

  async deleteTenantConfig(organizationId: string, id: string) {
    await this.getTenantConfigRow(organizationId, id)
    await this.prisma.paymentGatewayConfig.delete({ where: { id } })
    return { deleted: true }
  }

  async createTenantPayout(organizationId: string, dto: CreatePayoutDto) {
    const config = await this.getTenantConfigRow(organizationId, dto.configId)
    const gateway = this.factory.build(config)
    if (!gateway.supportsPayouts()) throw new BadRequestException(`${config.provider} does not support payouts`)
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

  webhookUrl(configId: string, provider: ProviderName): string {
    const base = (
      process.env.APP_PUBLIC_URL ||
      process.env.API_PUBLIC_URL ||
      'https://affiliate.mentoringhub.online'
    ).replace(/\/+$/, '')
    const prefix = process.env.API_PREFIX || 'v1'
    return `${base}/${prefix}/billing/webhooks/${provider}/${configId}`
  }

  // ── Save card (setup) ─────────────────────────────────────────────────────────
  async startSetup(organizationId: string, dto: StartSetupDto) {
    const org = await this.getOrg(organizationId)
    const config = await this.pickConfig(dto.configId, dto.provider)
    const gateway = this.factory.build(config)
    const returnUrl = dto.returnUrl ? this.validatedReturnUrl(dto.returnUrl) : undefined
    const session = await gateway.createSetupSession({
      email: org.email ?? undefined,
      name: org.name,
      returnUrl,
      metadata: { organizationId, configId: config.id },
    })
    await this.prisma.billingCustomer.upsert({
      where: { organizationId_configId: { organizationId, configId: config.id } },
      create: { organizationId, configId: config.id, provider: config.provider, email: org.email ?? null },
      update: {},
    })
    return { url: session.url, sessionId: session.id, provider: config.provider }
  }

  // ── Off-session charge (+ tax) ────────────────────────────────────────────────
  /**
   * Charge a tenant off-session.
   * @param options.idempotencyKey Stable key for idempotent retry (used by billing cycle).
   * @param options.periodStart    Subscription period this charge covers.
   */
  async chargeTenant(
    organizationId: string,
    dto: ChargeTenantDto,
    options?: { idempotencyKey?: string; periodStart?: Date },
  ) {
    const org = await this.getOrg(organizationId)
    const { config, customer } = await this.requireCustomer(organizationId)
    const gateway = this.factory.build(config)
    const currency = (dto.currency || org.defaultCurrency || 'USD').toUpperCase()

    const subtotal = dto.amountCents
    const tax = this.computeTaxCents(subtotal, config)
    const total = subtotal + tax
    const lineItems = this.buildLineItems(dto.description ?? 'Subscription charge', subtotal, tax, config)

    const invoice = await this.prisma.billingInvoice.create({
      data: {
        organizationId, configId: config.id, customerId: customer.id, provider: config.provider,
        status: 'open', currency, subtotalCents: subtotal, taxCents: tax, totalCents: total,
        lineItems: lineItems as any,
        metadata: {
          description: dto.description ?? null,
          idempotencyKey: options?.idempotencyKey ?? null,
          periodStart: options?.periodStart ?? null,
        } as any,
      },
    })

    const result = await gateway.createInvoice({
      memberOrCustomerId: customer.providerMemberId ?? customer.providerCustomerId ?? undefined,
      paymentMethodId: customer.defaultPaymentMethodId ?? undefined,
      currency, lineItems, subtotalCents: subtotal, taxCents: tax, totalCents: total,
      description: dto.description ?? undefined,
      autoCharge: dto.autoCharge ?? true,
      metadata: { organizationId, invoiceId: invoice.id },
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

  // ── Subscriptions ─────────────────────────────────────────────────────────────
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
        trialEndsAt, currentPeriodEnd: trialEndsAt ?? this.nextPeriodEnd(plan.interval),
      },
    })
    await this.prisma.organization.update({ where: { id: organizationId }, data: { plan: plan.key } })

    const setup = await this.startSetup(organizationId, { configId: dto.configId, returnUrl: dto.returnUrl })
    return { planKey: plan.key, trialDays, trialEndsAt, setupUrl: setup.url, provider: setup.provider }
  }

  /**
   * Billing cycle worker: charge every subscription whose trial/period has ended.
   *
   * Concurrency safety: we claim each subscription with an atomic `updateMany`
   * guarded by `billingLockToken IS NULL`. If another worker already claimed it
   * (count === 0), we skip with `{ ok: true, skipped: true }` so the same
   * subscription is never double-charged across parallel workers.
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
    for (const sub of due) {
      const periodEnd = sub.currentPeriodEnd ?? now
      // Deterministic, stable key: identifies this exact billing cycle instance.
      const lockKey = `subscription:${sub.id}:${periodEnd.toISOString()}`
      // Atomically claim the subscription. count === 0 means already claimed.
      const claimed = await this.prisma.subscription.updateMany({
        where: { id: sub.id, ...({ billingLockToken: null } as any) },
        data: { ...({ billingLockToken: lockKey } as any) },
      })
      if (claimed.count === 0) {
        results.push({ organizationId: sub.organizationId, ok: true, skipped: true })
        continue
      }
      try {
        if (sub.plan.priceCents > 0) {
          await this.chargeTenant(
            sub.organizationId,
            {
              amountCents: sub.plan.priceCents,
              currency: sub.plan.currency,
              description: `${sub.plan.name} (${sub.plan.interval}ly)`,
              recurring: true,
              autoCharge: true,
            },
            {
              idempotencyKey: lockKey,
              periodStart: periodEnd,
            },
          )
        }
        await this.prisma.subscription.updateMany({
          where: { id: sub.id },
          data: {
            status: 'active',
            currentPeriodEnd: this.nextPeriodEnd(sub.plan.interval, periodEnd),
            ...({ billingLockToken: null } as any),
          },
        })
        results.push({ organizationId: sub.organizationId, ok: true })
      } catch (e: any) {
        await this.prisma.subscription.updateMany({
          where: { id: sub.id },
          data: { status: 'past_due', ...({ billingLockToken: null } as any) },
        })
        results.push({ organizationId: sub.organizationId, ok: false, error: e?.message })
      }
    }
    return { processed: due.length, results }
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────
  listInvoices(organizationId?: string) {
    return this.prisma.billingInvoice.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: 'desc' }, take: 200,
    })
  }

  // ── Payouts ───────────────────────────────────────────────────────────────────
  async createPayout(dto: CreatePayoutDto) {
    const config = await this.getConfigRow(dto.configId)
    const gateway = this.factory.build(config)
    if (!gateway.supportsPayouts()) throw new BadRequestException(`${config.provider} does not support payouts`)
    const destination = dto.destination
    if (destination) this.assertPayoutDestination(destination as { account: string })
    return gateway.createPayout({
      amountCents: dto.amountCents,
      currency: (dto.currency || 'PKR').toUpperCase(),
      destination, reference: dto.reference, purpose: dto.purpose,
    })
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  async handleWebhook(provider: ProviderName, configId: string, rawBody: string, headers: Record<string, any>) {
    const config = await this.getConfigRow(configId)
    if (config.provider !== provider) throw new BadRequestException('Provider/config mismatch')
    const gateway = this.factory.build(config)
    const evt = gateway.verifyAndParseWebhook({ rawBody, headers })

    const dedupeId = evt.id || `${provider}:${Date.now()}`
    const existing = await this.prisma.gatewayEvent.findUnique({
      where: { provider_eventId: { provider, eventId: dedupeId } },
    }).catch(() => null)
    if (existing) return { ok: true, duplicate: true }

    const record = await this.prisma.gatewayEvent.create({
      data: { provider, eventId: dedupeId, type: evt.type, payload: evt.raw as any, status: 'received' },
    })
    try {
      await this.processEvent(config, evt)
      await this.prisma.gatewayEvent.update({ where: { id: record.id }, data: { status: 'processed', processedAt: new Date() } })
    } catch (e: any) {
      await this.prisma.gatewayEvent.update({ where: { id: record.id }, data: { status: 'failed', error: e?.message?.slice(0, 500) } })
      this.log.error(`Webhook ${evt.type} processing failed: ${e?.message}`)
    }
    return { ok: true }
  }

  private async processEvent(config: PaymentGatewayConfig, evt: NormalizedEvent) {
    const data = evt.data ?? {}
    switch (evt.type) {
      case 'setup_intent.succeeded': {
        const organizationId = data.metadata?.organizationId ?? data.checkout_configuration?.metadata?.organizationId
        const pm = data.payment_method ?? {}
        const memberId = data.member?.id ?? data.member_id
        if (organizationId) {
          await this.prisma.billingCustomer.updateMany({
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
        }
        break
      }
      case 'payment.succeeded': {
        const invoiceId = data.metadata?.invoiceId
        if (invoiceId) {
          await this.prisma.billingInvoice.updateMany({
            where: { id: invoiceId }, data: { status: 'paid', paidAt: new Date(), providerPaymentId: data.id ?? undefined },
          })
        }
        break
      }
      case 'payment.failed': {
        const organizationId = data.metadata?.organizationId
        if (organizationId) {
          await this.prisma.subscription.updateMany({ where: { organizationId }, data: { status: 'past_due' } })
        }
        break
      }
      case 'membership.deactivated': {
        const organizationId = data.metadata?.organizationId
        if (organizationId) {
          await this.prisma.subscription.updateMany({ where: { organizationId }, data: { status: 'canceled' } })
        }
        break
      }
      default:
        this.log.debug(`Unhandled ${config.provider} event: ${evt.type}`)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  private computeTaxCents(subtotalCents: number, config: PaymentGatewayConfig): number {
    if (!config.taxEnabled || config.taxPercent <= 0) return 0
    if (config.taxInclusive) return 0
    return Math.round((subtotalCents * config.taxPercent) / 100)
  }

  private buildLineItems(description: string, subtotalCents: number, taxCents: number, config: PaymentGatewayConfig): LineItem[] {
    const items: LineItem[] = [{ description, amountCents: subtotalCents, quantity: 1, kind: 'plan' }]
    if (taxCents > 0) {
      items.push({ description: `${config.taxLabel ?? 'Tax'} (${config.taxPercent}%)`, amountCents: taxCents, quantity: 1, kind: 'tax' })
    }
    return items
  }

  /**
   * Advance a subscription period by one interval.
   * Clips month-end overflow so e.g. Jan 31 + 1 month → Feb 28 (not Mar 3).
   */
  private nextPeriodEnd(interval: 'month' | 'year', from: Date = new Date()): Date {
    const d = new Date(from)
    if (interval === 'year') {
      d.setFullYear(d.getFullYear() + 1)
    } else {
      const targetMonth = (d.getMonth() + 1) % 12
      d.setMonth(d.getMonth() + 1)
      // Clip overflow: JS rolls Jan 31 → Mar 3, so we snap back to Feb 28
      if (d.getMonth() !== targetMonth) {
        d.setDate(0) // day 0 of current month = last day of previous month
      }
    }
    return d
  }

  /**
   * Validate and return a return URL, ensuring it shares the same origin as APP_URL.
   */
  private validatedReturnUrl(url: string): string {
    const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '')
    if (!appUrl || !url.startsWith(appUrl)) {
      throw new BadRequestException('Invalid return URL: origin does not match APP_URL')
    }
    return url
  }

  /**
   * Guard against oversized payout destination payloads.
   */
  private assertPayoutDestination(dest: { account: string }): void {
    if (!dest?.account || dest.account.length > 1000) {
      throw new BadRequestException('Payout destination account is invalid or exceeds maximum length')
    }
  }

  private async getConfigRow(id: string): Promise<PaymentGatewayConfig> {
    const row = await this.prisma.paymentGatewayConfig.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Gateway config not found')
    return row
  }

  private async pickConfig(configId?: string, provider?: ProviderName): Promise<PaymentGatewayConfig> {
    if (configId) return this.getConfigRow(configId)
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
    return { config, customer }
  }

  private async getOrg(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { users: { where: {}, take: 1, orderBy: { createdAt: 'asc' } } },
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
