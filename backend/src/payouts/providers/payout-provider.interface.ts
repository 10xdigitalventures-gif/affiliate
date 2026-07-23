/**
 * Common contract every payout provider (Stripe, Wise, manual, ...) implements.
 * Keeps PayoutsService decoupled from any specific rail.
 */
export interface SendPayoutInput {
  /** Internal payout id (used for idempotency keys). */
  payoutId: string
  amount: number
  currency: string
  /** Decrypted destination details captured from the affiliate's payout method. */
  destination: Record<string, unknown>
  /** Affiliate-facing statement descriptor / memo. */
  memo?: string
}

export type PayoutProviderStatus = 'paid' | 'processing' | 'failed'

export interface SendPayoutResult {
  /** Provider-side transaction id / transfer id. */
  reference: string | null
  /**
   * paid       -> money moved (or accepted as final)
   * processing -> accepted, settlement is async (confirm later via webhook/poll)
   * failed     -> rejected
   */
  status: PayoutProviderStatus
  /** Human-readable error when status === 'failed'. */
  error?: string
  /** Raw provider payload for auditing. */
  raw?: unknown
}

export interface PayoutProvider {
  /** Provider key matching the PayoutMethod enum (stripe | wise | manual | ...). */
  readonly method: string
  /** True when the provider has the credentials it needs to actually send. */
  isConfigured(): boolean
  send(input: SendPayoutInput): Promise<SendPayoutResult>
}
