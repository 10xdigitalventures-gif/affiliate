import { Injectable } from '@nestjs/common'
import type { PayoutProvider, SendPayoutInput, SendPayoutResult } from './payout-provider.interface'

/**
 * Fallback provider for rails with no automation (bank transfer, PayPal manual,
 * crypto, or `manual`). It never moves money — it returns `processing` so an
 * admin can settle the payout by hand via mark-paid.
 */
@Injectable()
export class ManualPayoutProvider implements PayoutProvider {
  readonly method = 'manual'
  isConfigured(): boolean {
    return true
  }
  async send(_input: SendPayoutInput): Promise<SendPayoutResult> {
    return { reference: null, status: 'processing' }
  }
}
