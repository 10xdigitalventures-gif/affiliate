import { Injectable, Logger } from '@nestjs/common'
import type { PayoutProvider, SendPayoutInput, SendPayoutResult } from './payout-provider.interface'

/**
 * PayPal Payouts provider.
 *
 * Flow: OAuth client-credentials token -> POST /v1/payments/payouts with a
 * single item addressed to the affiliate's PayPal email. The affiliate's payout
 * method must store their PayPal address under destination.paypalEmail.
 *
 * Env:
 *   PAYPAL_CLIENT_ID       REST app client id
 *   PAYPAL_CLIENT_SECRET   REST app secret
 *   PAYPAL_API_BASE        override (default https://api-m.paypal.com;
 *                          sandbox: https://api-m.sandbox.paypal.com)
 *
 * Uses global fetch (Node 18+), so no extra dependency is required.
 */
@Injectable()
export class PayPalPayoutProvider implements PayoutProvider {
  readonly method = 'paypal'
  private readonly logger = new Logger('PayPalPayoutProvider')

  isConfigured(): boolean {
    return !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET
  }

  private base(): string {
    return (process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com').replace(/\/$/, '')
  }

  private async accessToken(): Promise<string> {
    const creds = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
    ).toString('base64')
    const res = await fetch(`${this.base()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new Error(`oauth failed: ${res.status} ${await res.text()}`)
    const json: any = await res.json()
    return json.access_token
  }

  async send(input: SendPayoutInput): Promise<SendPayoutResult> {
    if (!this.isConfigured()) {
      return { reference: null, status: 'failed', error: 'PayPal not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing)' }
    }
    const receiver = String(input.destination.paypalEmail ?? input.destination.email ?? '')
    if (!receiver || !receiver.includes('@')) {
      return { reference: null, status: 'failed', error: 'Missing destination.paypalEmail' }
    }
    try {
      const token = await this.accessToken()
      // sender_batch_id = idempotency key: retrying the same payout never double-pays.
      const body = {
        sender_batch_header: {
          sender_batch_id: `payout_${input.payoutId}`,
          email_subject: input.memo ?? 'You have received an affiliate payout',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            receiver,
            amount: { value: input.amount.toFixed(2), currency: input.currency },
            note: input.memo ?? 'Affiliate payout',
            sender_item_id: input.payoutId,
          },
        ],
      }
      const res = await fetch(`${this.base()}/v1/payments/payouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`payout failed: ${res.status} ${await res.text()}`)
      const json: any = await res.json()
      const batchId = json?.batch_header?.payout_batch_id ?? null
      const batchStatus = json?.batch_header?.batch_status ?? 'PENDING'
      // PayPal settles asynchronously; SUCCESS is confirmed later via webhook/poll.
      const status = batchStatus === 'SUCCESS' ? 'paid' : 'processing'
      return { reference: batchId ? String(batchId) : null, status, raw: json }
    } catch (err: any) {
      this.logger.error(`PayPal payout failed for ${input.payoutId}: ${err?.message}`)
      return { reference: null, status: 'failed', error: err?.message ?? 'PayPal error' }
    }
  }
}
