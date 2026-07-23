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
 * Swich adapter — https://swichnow.io  (a brand by Numbers Pvt Ltd, Pakistan).
 *
 * Swich is a full-stack Pakistani payments platform offering:
 *   - Payment Gateway (cards Visa/Mastercard/UnionPay, JazzCash & Easypaisa
 *     wallets, 1LINK bank transfer, Raast QR), payment links, invoices, and
 *     recurring/subscription billing.
 *   - Payouts API (vendor/supplier payments, refunds, bulk disbursements,
 *     salary/commission payouts, marketplace settlements).
 *
 * NOTE ON ENDPOINTS: Swich's developer portal is access-gated, so the exact
 * REST paths/field names below follow standard gateway conventions and Swich's
 * published product capabilities. Every path is overridable via env so a real
 * integration can be finalised without code changes:
 *   SWICH_BASE_URL, SWICH_PATH_PAYMENTS, SWICH_PATH_PAYMENT_LINKS,
 *   SWICH_PATH_INVOICES, SWICH_PATH_PAYOUTS, SWICH_SIGNATURE_HEADER
 *
 * Credentials (from the Swich merchant dashboard):
 *   - companyId     => merchant / company id
 *   - apiKey        => Authorization: Bearer <apiKey>
 *   - webhookSecret => HMAC-SHA256 shared secret for webhook verification
 */
export class SwichGateway implements PaymentGateway {
  readonly provider = 'swich' as const
  private readonly baseUrl: string
  private readonly paths = {
    payments: process.env.SWICH_PATH_PAYMENTS || '/payments',
    paymentLinks: process.env.SWICH_PATH_PAYMENT_LINKS || '/payment-links',
    invoices: process.env.SWICH_PATH_INVOICES || '/invoices',
    payouts: process.env.SWICH_PATH_PAYOUTS || '/payouts',
    paymentMethods: process.env.SWICH_PATH_PAYMENT_METHODS || '/payment-methods',
  }
  private readonly sigHeader = (process.env.SWICH_SIGNATURE_HEADER || 'x-swich-signature').toLowerCase()

  constructor(private readonly creds: GatewayCredentials) {
    this.baseUrl = (creds.baseUrl || process.env.SWICH_BASE_URL || '').replace(/\/+$/, '')
  }

  private assertVerified() {
    if (process.env.SWICH_INTEGRATION_VERIFIED !== 'true') {
      throw new GatewayError(
        'Swich integration is disabled until merchant-specific endpoints and payloads are verified; set SWICH_INTEGRATION_VERIFIED=true only after certification',
        'swich',
        503,
      )
    }
    if (!/^https:\/\//i.test(this.baseUrl)) {
      throw new GatewayError('SWICH_BASE_URL must be an approved HTTPS API endpoint', 'swich', 500)
    }
    const required = [
      'SWICH_PATH_PAYMENTS',
      'SWICH_PATH_PAYMENT_LINKS',
      'SWICH_PATH_INVOICES',
      'SWICH_PATH_PAYOUTS',
      'SWICH_PATH_PAYMENT_METHODS',
    ]
    const missing = required.filter((key) => !process.env[key])
    if (missing.length) throw new GatewayError(`Missing verified Swich settings: ${missing.join(', ')}`, 'swich', 500)
  }

  private async req<T = any>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    this.assertVerified()
    if (!this.creds.apiKey) throw new GatewayError('Swich API key not configured', 'swich')
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(gatewayTimeoutMs()),
        headers: {
          Authorization: `Bearer ${this.creds.apiKey}`,
          'X-Company-Id': this.creds.companyId ?? '',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new GatewayError(`Swich ${method} ${path} timed out or could not be reached`, 'swich', 503)
    }
    const text = await res.text()
    const json = text ? safeJson(text) : {}
    if (!res.ok) {
      throw new GatewayError(`Swich ${method} ${path} failed: ${res.status}`, 'swich', res.status, json)
    }
    return json as T
  }

  // Swich saves the card by tokenising it during a hosted payment-link / mandate
  // flow; we create a zero-amount mandate link the customer completes once.
  async createSetupSession(input: CreateSetupInput): Promise<SetupSession> {
    const link = await this.req<any>('POST', this.paths.paymentLinks, {
      company_id: this.creds.companyId,
      type: 'mandate',
      save_payment_method: true,
      customer: { email: input.email ?? undefined, name: input.name ?? undefined },
      redirect_url: input.returnUrl ?? undefined,
      metadata: input.metadata ?? undefined,
    })
    return {
      id: link.id ?? link.reference ?? '',
      url: link.url ?? link.payment_url ?? link.link ?? null,
      provider: 'swich',
      raw: link,
    }
  }

  async listPaymentMethods(customerId: string): Promise<SavedPaymentMethod[]> {
    const out = await this.req<any>('GET', `${this.paths.paymentMethods}?customer_id=${encodeURIComponent(customerId)}`)
    const rows: any[] = out?.data ?? out?.payment_methods ?? []
    return rows.map((pm) => ({
      id: pm.id ?? pm.token,
      brand: pm.brand ?? pm.scheme ?? pm.type ?? null,
      last4: pm.last4 ?? pm.masked_pan?.slice(-4) ?? null,
      expMonth: pm.exp_month ?? null,
      expYear: pm.exp_year ?? null,
      raw: pm,
    }))
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const p = await this.req<any>('POST', this.paths.payments, {
      company_id: this.creds.companyId,
      // Swich amounts are in major units (PKR rupees) with the currency code.
      amount: round2(input.amountCents / 100),
      currency: input.currency.toUpperCase(),
      customer_id: input.memberOrCustomerId ?? undefined,
      payment_method_id: input.paymentMethodId ?? undefined,
      description: input.description ?? undefined,
      recurring: !!input.recurring,
      metadata: input.metadata ?? undefined,
    })
    return { id: p.id ?? p.transaction_id ?? '', status: p.status ?? 'processing', provider: 'swich', raw: p }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const inv = await this.req<any>('POST', this.paths.invoices, {
      company_id: this.creds.companyId,
      customer_id: input.memberOrCustomerId ?? undefined,
      payment_method_id: input.paymentMethodId ?? undefined,
      currency: input.currency.toUpperCase(),
      auto_charge: !!input.autoCharge,
      due_date: input.dueAt ? input.dueAt.toISOString() : undefined,
      metadata: input.metadata ?? undefined,
      items: input.lineItems.map((li) => ({
        description: li.description,
        amount: round2(li.amountCents / 100),
        quantity: li.quantity ?? 1,
      })),
    }, input.idempotencyKey)
    return {
      id: inv.id ?? inv.invoice_id ?? '',
      number: inv.number ?? inv.invoice_number ?? null,
      status: inv.status ?? (input.autoCharge ? 'open' : 'draft'),
      hostedUrl: inv.url ?? inv.hosted_url ?? inv.payment_url ?? null,
      pdfUrl: inv.pdf_url ?? null,
      provider: 'swich',
      raw: inv,
    }
  }

  // HMAC-SHA256 hex of the raw body with the shared webhook secret.
  verifyAndParseWebhook(req: WebhookRequest): NormalizedEvent {
    this.assertVerified()
    const secret = this.creds.webhookSecret
    if (!secret) throw new GatewayError('Swich webhook secret not configured', 'swich')
    const provided = header(req.headers, this.sigHeader)
    if (!provided) throw new GatewayError('Missing Swich webhook signature header', 'swich', 400)
    const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex')
    const cleaned = provided.replace(/^sha256=/, '')
    if (!safeEqual(cleaned, expected)) throw new GatewayError('Swich webhook signature mismatch', 'swich', 401)
    const evt = strictJson(req.rawBody)
    return {
      id: evt.id ?? evt.event_id ?? header(req.headers, 'x-swich-event-id') ?? '',
      type: evt.type ?? evt.event ?? 'unknown',
      data: evt.data ?? evt,
      provider: 'swich',
      raw: evt,
    }
  }

  supportsPayouts(): boolean {
    return true
  }

  // Disburse funds to a bank account / JazzCash / Easypaisa / Raast beneficiary.
  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    const po = await this.req<any>('POST', this.paths.payouts, {
      company_id: this.creds.companyId,
      amount: round2(input.amountCents / 100),
      currency: input.currency.toUpperCase(),
      reference: input.reference ?? undefined,
      purpose: input.purpose ?? undefined,
      beneficiary: input.destination,
    })
    return { id: po.id ?? po.payout_id ?? '', status: po.status ?? 'processing', provider: 'swich', raw: po }
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
function strictJson(text: string): any {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    throw new GatewayError('Swich webhook body is not valid JSON', 'swich', 400)
  }
}
function gatewayTimeoutMs(): number {
  return Math.min(Math.max(Number(process.env.GATEWAY_HTTP_TIMEOUT_MS) || 15_000, 1_000), 30_000)
}
