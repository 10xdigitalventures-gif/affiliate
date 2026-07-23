import { Injectable, Logger } from '@nestjs/common'
import type { PayoutProvider, SendPayoutInput, SendPayoutResult } from './payout-provider.interface'

/**
 * Stripe payout provider.
 *
 * Uses Stripe Connect **Transfers** to move funds from the platform balance to a
 * connected affiliate account. The affiliate's payout method must store a
 * Stripe connected-account id under `destination.stripeAccountId` (acct_...).
 *
 * Env:
 *   STRIPE_SECRET_KEY   platform secret key (sk_live_... / sk_test_...)
 *
 * The `stripe` SDK is imported lazily so the app still boots when Stripe is
 * unconfigured or the dependency isn't installed.
 */
@Injectable()
export class StripePayoutProvider implements PayoutProvider {
  readonly method = 'stripe'
  private readonly logger = new Logger('StripePayoutProvider')

  isConfigured(): boolean {
    return !!process.env.STRIPE_SECRET_KEY
  }

  private client(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe')
    return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  }

  async send(input: SendPayoutInput): Promise<SendPayoutResult> {
    if (!this.isConfigured()) {
      return { reference: null, status: 'failed', error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' }
    }
    const stripeAccountId = String(input.destination.stripeAccountId ?? '')
    if (!stripeAccountId.startsWith('acct_')) {
      return { reference: null, status: 'failed', error: 'Missing/invalid destination.stripeAccountId (expected acct_...)' }
    }
    try {
      const stripe = this.client()
      // Stripe amounts are in the smallest currency unit (cents).
      const amountMinor = Math.round(input.amount * 100)
      const transfer = await stripe.transfers.create(
        {
          amount: amountMinor,
          currency: input.currency.toLowerCase(),
          destination: stripeAccountId,
          description: input.memo ?? `Affiliate payout ${input.payoutId}`,
          metadata: { payoutId: input.payoutId },
        },
        // Idempotency: retrying the same payout never double-pays.
        { idempotencyKey: `payout_${input.payoutId}` },
      )
      return { reference: transfer.id, status: 'paid', raw: transfer }
    } catch (err: any) {
      this.logger.error(`Stripe transfer failed for payout ${input.payoutId}: ${err?.message}`)
      return { reference: null, status: 'failed', error: err?.message ?? 'Stripe error', raw: err?.raw ?? null }
    }
  }
}
