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

  constructor(private readonly creds: GatewayCredentials) {
    const officialBase = creds.isLive
      ? 'https://api.whop.com/api/v1'
      : 'https://sandbox-api.whop.com/api/v1'
    this.baseUrl = (creds.baseUrl || officialBase).replace(/\/+$/, '')
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────
  private async req<T = any>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.creds.apiKey) throw new GatewayError('Whop API key not configured', 'whop')
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(gatewayTimeoutMs()),
        headers: {
          Authorization: `Bearer ${this.creds.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new GatewayError(`Whop ${method} ${path} timed out or could not be reached`, 'whop', 503)
    }
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
      // Whop expects a major-unit decimal price on the inline plan.
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
      collection_method: input.autoCharge ? 'charge_automatically' : 'send_invoice',
      due_date: input.dueAt?.toISOString(),
      plan: {
        initial_price: round2(input.totalCents / 100),
        currency: input.currency.toLowerCase(),
        plan_type: 'one_time',
      },
      product: { title: input.description ?? 'Platform subscription' },
      line_items: input.lineItems.map((li) => ({
        label: li.description,
        unit_price: round2(li.amountCents / 100),
        quantity: li.quantity ?? 1,
      })),
    }, input.idempotencyKey)
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

    const timestampSeconds = Number(ts)
    const tolerance = Math.min(Math.max(Number(process.env.WHOP_WEBHOOK_TOLERANCE_SECONDS) || 300, 60), 900)
    if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > tolerance) {
      throw new GatewayError('Whop webhook timestamp is outside the allowed replay window', 'whop', 401)
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    if (secretBytes.length < 16) throw new GatewayError('Whop webhook secret is invalid', 'whop', 500)
    const signedContent = `${id}.${ts}.${req.rawBody}`
    const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64')

    const provided = sigHeader.split(' ').map((p) => p.split(',')[1] ?? p)
    const ok = provided.some((p) => safeEqual(p, expected))
    if (!ok) throw new GatewayError('Whop webhook signature mismatch', 'whop', 401)

    const evt = strictJson(req.rawBody, 'whop')
    if (this.creds.companyId && evt.company_id && evt.company_id !== this.creds.companyId) {
      throw new GatewayError('Whop webhook company does not match this gateway', 'whop', 401)
    }
    return { id, type: evt.type ?? 'unknown', data: evt.data ?? evt, provider: 'whop', raw: evt }
  }

  supportsPayouts(): boolean {
    return true
  }

  // Whop payouts move money out of your ledger to a payout method / connected user.
  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    const destinationId = String(input.destination.destinationId ?? input.destination.id ?? '').trim()
    if (!destinationId) throw new GatewayError('Whop destinationId is required for a transfer', 'whop', 400)
    if (!this.creds.companyId) throw new GatewayError('Whop company id not configured', 'whop', 400)
    const tr = await this.req<any>('POST', '/transfers', {
      amount: round2(input.amountCents / 100),
      currency: input.currency.toLowerCase(),
      origin_id: this.creds.companyId,
      destination_id: destinationId,
      idempotence_key: input.reference ?? undefined,
      notes: input.purpose?.slice(0, 50) ?? undefined,
      metadata: input.reference ? { reference: input.reference } : undefined,
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
function strictJson(text: string, provider: 'whop'): any {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    throw new GatewayError('Whop webhook body is not valid JSON', provider, 400)
  }
}
function gatewayTimeoutMs(): number {
  return Math.min(Math.max(Number(process.env.GATEWAY_HTTP_TIMEOUT_MS) || 15_000, 1_000), 30_000)
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
