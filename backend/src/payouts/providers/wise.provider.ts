import { Injectable, Logger } from '@nestjs/common'
import type { PayoutProvider, SendPayoutInput, SendPayoutResult } from './payout-provider.interface'

/**
 * Wise (TransferWise) payout provider.
 *
 * Flow: create quote -> create transfer against an existing recipient -> fund it
 * from the platform balance. The affiliate's payout method must store a Wise
 * `recipientId` under `destination.wiseRecipientId`.
 *
 * Env:
 *   WISE_API_TOKEN    platform API token
 *   WISE_PROFILE_ID   platform profile id
 *   WISE_API_BASE     override (default https://api.wise.com; sandbox: https://api.sandbox.transferwise.tech)
 *
 * Uses global fetch (Node 18+), so no extra dependency is required.
 */
@Injectable()
export class WisePayoutProvider implements PayoutProvider {
  readonly method = 'wise'
  private readonly logger = new Logger('WisePayoutProvider')

  isConfigured(): boolean {
    return !!process.env.WISE_API_TOKEN && !!process.env.WISE_PROFILE_ID
  }

  private base() {
    return process.env.WISE_API_BASE || 'https://api.wise.com'
  }

  private headers() {
    return {
      Authorization: `Bearer ${process.env.WISE_API_TOKEN}`,
      'Content-Type': 'application/json',
    }
  }

  async send(input: SendPayoutInput): Promise<SendPayoutResult> {
    if (!this.isConfigured()) {
      return { reference: null, status: 'failed', error: 'Wise not configured (WISE_API_TOKEN / WISE_PROFILE_ID missing)' }
    }
    const recipientId = input.destination.wiseRecipientId
    if (!recipientId) {
      return { reference: null, status: 'failed', error: 'Missing destination.wiseRecipientId' }
    }
    const profileId = process.env.WISE_PROFILE_ID
    try {
      // 1) Quote
      const quoteRes = await fetch(`${this.base()}/v3/profiles/${profileId}/quotes`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          sourceCurrency: input.currency,
          targetCurrency: input.currency,
          targetAmount: input.amount,
          payOut: 'BALANCE',
        }),
      })
      if (!quoteRes.ok) throw new Error(`quote failed: ${quoteRes.status} ${await quoteRes.text()}`)
      const quote: any = await quoteRes.json()

      // 2) Transfer (customerTransactionId = idempotency key)
      const transferRes = await fetch(`${this.base()}/v1/transfers`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          targetAccount: recipientId,
          quoteUuid: quote.id,
          customerTransactionId: `payout_${input.payoutId}`,
          details: { reference: (input.memo ?? 'Payout').slice(0, 12) },
        }),
      })
      if (!transferRes.ok) throw new Error(`transfer failed: ${transferRes.status} ${await transferRes.text()}`)
      const transfer: any = await transferRes.json()

      // 3) Fund from balance
      const fundRes = await fetch(`${this.base()}/v3/profiles/${profileId}/transfers/${transfer.id}/payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ type: 'BALANCE' }),
      })
      if (!fundRes.ok) throw new Error(`funding failed: ${fundRes.status} ${await fundRes.text()}`)
      const funded: any = await fundRes.json()

      // Wise settles asynchronously; treat as processing unless already outgoing.
      const status = funded?.status === 'COMPLETED' ? 'paid' : 'processing'
      return { reference: String(transfer.id), status, raw: { quote, transfer, funded } }
    } catch (err: any) {
      this.logger.error(`Wise payout failed for ${input.payoutId}: ${err?.message}`)
      return { reference: null, status: 'failed', error: err?.message ?? 'Wise error' }
    }
  }
}
