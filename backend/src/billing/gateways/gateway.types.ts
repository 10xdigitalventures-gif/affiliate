/**
 * Gateway-agnostic billing contracts.
 *
 * The platform charges its own clients (tenants) for SaaS plans through a
 * pluggable PaymentGateway. Two implementations ship today:
 *   - WhopGateway  : Stripe-like Merchant of Record (cards on file, off-session
 *                    charges, hosted invoices/receipts, taxes, subscriptions).
 *   - SwichGateway : Pakistani gateway (cards + JazzCash/Easypaisa/Raast/1LINK)
 *                    with payouts/disbursements.
 *
 * All money is passed in integer minor units (cents/paisa) at this boundary;
 * each adapter converts to whatever its API expects.
 */
export type GatewayProviderKey = 'whop' | 'swich'
/** Alias for code that refers to the provider discriminator as ProviderName. */
export type ProviderName = GatewayProviderKey

export interface GatewayCredentials {
  provider: GatewayProviderKey
  /** Whop biz_... company id, or Swich company/merchant id. */
  companyId?: string | null
  apiKey?: string | null
  webhookSecret?: string | null
  /** false => use the provider sandbox base URL when one exists. */
  isLive: boolean
  /** Optional override of the API base URL (useful for sandbox / self-host). */
  baseUrl?: string | null
}

export interface LineItem {
  description: string
  amountCents: number
  quantity?: number
  kind?: 'plan' | 'tax' | 'discount' | 'adjustment'
}

export interface CreateSetupInput {
  email?: string | null
  name?: string | null
  /** Where to send the customer back after saving their card. */
  returnUrl?: string | null
  metadata?: Record<string, string>
}

export interface SetupSession {
  id: string
  /** Hosted URL to collect / save the payment method. */
  url: string | null
  provider: GatewayProviderKey
  raw?: unknown
}

export interface SavedPaymentMethod {
  id: string
  brand?: string | null
  last4?: string | null
  expMonth?: number | null
  expYear?: number | null
  raw?: unknown
}

export interface ChargeInput {
  amountCents: number
  currency: string
  description?: string
  /** Whop member id (mber_...) or Swich customer id. */
  memberOrCustomerId?: string | null
  paymentMethodId?: string | null
  /** true => recurring plan charge, false => one-time. */
  recurring?: boolean
  metadata?: Record<string, string>
  promoCodeId?: string | null
}

export interface ChargeResult {
  id: string
  status: string
  provider: GatewayProviderKey
  raw?: unknown
}

export interface CreateInvoiceInput {
  memberOrCustomerId?: string | null
  paymentMethodId?: string | null
  currency: string
  lineItems: LineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  description?: string
  dueAt?: Date | null
  /** true => charge the saved card now; false => email the client to pay. */
  autoCharge?: boolean
  metadata?: Record<string, string>
}

export interface InvoiceResult {
  id: string
  number?: string | null
  status: string
  hostedUrl?: string | null
  pdfUrl?: string | null
  provider: GatewayProviderKey
  raw?: unknown
}

export interface PayoutInput {
  amountCents: number
  currency: string
  /** Bank / wallet destination (IBAN, account, JazzCash/Easypaisa number, etc). */
  destination: Record<string, unknown>
  reference?: string
  purpose?: string
}

export interface PayoutResult {
  id: string
  status: string
  provider: GatewayProviderKey
  raw?: unknown
}

export interface WebhookRequest {
  rawBody: string
  headers: Record<string, string | string[] | undefined>
}

export interface NormalizedEvent {
  /** Stable provider event id (used as the idempotency key). */
  id: string
  type: string
  data: any
  provider: GatewayProviderKey
  raw: any
}

/** Every gateway adapter implements this surface. */
export interface PaymentGateway {
  readonly provider: GatewayProviderKey
  /** Collect + store a card without charging (free-trial / on-file). */
  createSetupSession(input: CreateSetupInput): Promise<SetupSession>
  /** List cards already stored for a customer. */
  listPaymentMethods(memberOrCustomerId: string): Promise<SavedPaymentMethod[]>
  /** Charge a stored card off-session. */
  charge(input: ChargeInput): Promise<ChargeResult>
  /** Create (and optionally auto-charge) an invoice; provider emails a receipt. */
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>
  /** Verify signature + normalise an inbound webhook. Throws on bad signature. */
  verifyAndParseWebhook(req: WebhookRequest): NormalizedEvent
  supportsPayouts(): boolean
  /** Send money out (client payouts / affiliate disbursements). */
  createPayout(input: PayoutInput): Promise<PayoutResult>
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly provider: GatewayProviderKey,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}
