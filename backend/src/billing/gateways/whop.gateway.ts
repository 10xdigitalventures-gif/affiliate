import { createHmac, timingSafeEqual } from 'crypto'
import {
  ChargeInput,
  ChargeResult,
  CreateInvoiceInput,
  CreateSetupInput,
  GatewayCredentials,
  GatewayError,
  InvoiceResult,
  NormalizedEvent,
  PayoutInput,
  PayoutResult,
  PaymentGateway,
  SavedPaymentMethod,
  SetupSession,
  WebhookRequest,
} from './gateway.types'

/**
 * Whop adapter — https://docs.whop.com  (base https://api.whop.com/api/v1)
 *
 * Whop is a full Merchant of Record, so it behaves like Stripe: it stores the
 * customer's card, charges it off-session, generates hosted invoices, emails
 * receipts, and handles tax/compliance. We only orchestrate.
 *
 * Credentials (from the Whop dashboard, Developer tab):
 *   - companyId       => biz_XXXXXXXX
 *   - apiKey          => Authorization: Bearer <apiKey>  (server-side only)
 *   - webhookSecret   => whsec_...  (Standard Webhooks HMAC-SHA256)
 */
export class WhopGateway implements PaymentGateway {
  readonly provider = 'whop' as const
  private readonly baseUrl: string
  private static readonly REPLAY_WINDOW_SECONDS = 600

  constructor(private readonly creds: GatewayCredentials) {
    this.baseUrl = (creds.baseUrl || 'https://api.whop.com/api/v1').replace(/\/+$/, '')
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────
  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.creds.apiKey) throw new GatewayError('Whop API key not configured', 'whop')
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.creds.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const json = text ? safeJson(text) : {}
    if (!res.ok) {
      throw new GatewayError(
        `Whop ${method} ${path} failed: ${res.status}`,
        'whop',
        res.status,
        json,
      )
    }
    return json as T
  }

  // ── Save a card (setup mode, no charge) ─────────────────────────────────────
  async createSetupSession(input: CreateSetupInput): Promise<SetupSession> {
    const cfg = await this.req<any>('POST', '/checkout_configurations', {
      company_id: this.creds.companyId,
      mode: 'setup',
      redirect_url: input.returnUrl ?? undefined,
      metadata: input.metadata ?? undefined,
    })
    return {
      id: cfg.id,
      url: cfg.purchase_url ?? cfg.checkout_url ?? null,
      provider: 'whop',
      raw: cfg,
    }
  }

  async listPaymentMethods(memberId: string): Promise<SavedPaymentMethod[]> {
    const out = await this.req<any>('GET', `/payment_methods?member_id=${encodeURIComponent(memberId)}`)
    const rows: any[] = out?.data ?? []
    return rows.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? pm.brand ?? null,
      last4: pm.card?.last4 ?? pm.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      raw: pm,
    }))
  }

  // ── Off-session charge ──────────────────────────────────────────────────────
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const payment = await this.req<any>('POST', '/payments', {
      company_id: this.creds.companyId,
      member_id: input.memberOrCustomerId ?? undefined,
      payment_method_id: input.paymentMethodId ?? undefined,
      promo_code_id: input.promoCodeId ?? undefined,
      metadata: input.metadata ?? undefined,
      plan: {
        initial_price: round2(input.amountCents / 100),
        currency: input.currency.toLowerCase(),
        plan_type: input.recurring ? 'renewal' : 'one_time',
      },
    })
    return { id: payment.id, status: payment.status ?? 'processing', provider: 'whop', raw: payment }
  }

  // ── Hosted invoice (auto-charge or emailed for manual pay) ──────────────────
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const inv = await this.req<any>('POST', '/invoices', {
      company_id: this.creds.companyId,
      member_id: input.memberOrCustomerId ?? undefined,
      payment_method_id: input.paymentMethodId ?? undefined,
      currency: input.currency.toLowerCase(),
      collection_method: input.autoCharge ? 'charge_automatically' : 'send_invoice',
      due_at: input.dueAt ? Math.floor(input.dueAt.getTime() / 1000) : undefined,
      metadata: input.metadata ?? undefined,
      line_items: input.lineItems.map((li) => ({
        description: li.description,
        amount: round2(li.amountCents / 100),
        quantity: li.quantity ?? 1,
      })),
    })
    return {
      id: inv.id,
      number: inv.number ?? null,
      status: inv.status ?? (input.autoCharge ? 'open' : 'draft'),
      hostedUrl: inv.hosted_url ?? inv.url ?? null,
      pdfUrl: inv.pdf_url ?? null,
      provider: 'whop',
      raw: inv,
    }
  }

  // ── Webhook verification (Standard Webhooks spec) ───────────────────────────
  // Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<b64hmac>").
  // signed = `${id}.${timestamp}.${rawBody}` ; key = base64-decode(secret sans whsec_).
  verifyAndParseWebhook(req: WebhookRequest): NormalizedEvent {
    const secret = this.creds.webhookSecret
    if (!secret) throw new GatewayError('Whop webhook secret not configured', 'whop')
    const id = header(req.headers, 'webhook-id')
    const ts = header(req.headers, 'webhook-timestamp')
    const sigHeader = header(req.headers, 'webhook-signature')
    if (!id || !ts || !sigHeader) throw new GatewayError('Missing Whop webhook signature headers', 'whop', 400)

    // ── Replay attack protection ─────────────────────────────────────────────
    // Reject webhooks whose timestamp is older than the replay window.
    const tsNum = Number(ts)
    if (isNaN(tsNum) || Math.floor(Date.now() / 1000) - tsNum > WhopGateway.REPLAY_WINDOW_SECONDS) {
      throw new GatewayError('Whop webhook replay rejected: request is stale', 'whop', 401)
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const signedContent = `${id}.${ts}.${req.rawBody}`
    const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64')

    const provided = sigHeader.split(' ').map((p) => p.split(',')[1] ?? p)
    const ok = provided.some((p) => safeEqual(p, expected))
    if (!ok) throw new GatewayError('Whop webhook signature mismatch', 'whop', 401)

    const evt = safeJson(req.rawBody)

    // ── Company ID validation ────────────────────────────────────────────────
    // Reject events that are signed correctly but belong to a different company.
    if (this.creds.companyId && evt.company_id && evt.company_id !== this.creds.companyId) {
      throw new GatewayError('Whop webhook company does not match', 'whop', 401)
    }

    return { id, type: evt.type ?? 'unknown', data: evt.data ?? evt, provider: 'whop', raw: evt }
  }

  supportsPayouts(): boolean {
    return true
  }

  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    const tr = await this.req<any>('POST', '/transfers', {
      company_id: this.creds.companyId,
      amount: round2(input.amountCents / 100),
      currency: input.currency.toLowerCase(),
      destination: input.destination,
      idempotence_key: input.reference ?? undefined,
      reason: input.purpose ?? undefined,
    })
    return { id: tr.id, status: tr.status ?? 'processing', provider: 'whop', raw: tr }
  }
}

// ── local helpers ─────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function safeJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
function header(h: WebhookRequest['headers'], name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
