import { Injectable, Logger } from '@nestjs/common'
import type { PayoutProvider, SendPayoutInput, SendPayoutResult } from './payout-provider.interface'
import { StripePayoutProvider } from './stripe.provider'
import { WisePayoutProvider } from './wise.provider'
import { PayPalPayoutProvider } from './paypal.provider'
import { ManualPayoutProvider } from './manual.provider'

/**
 * Dispatches a payout to the right provider based on the PayoutMethod.
 * Rails without an automated integration (bank / paypal / crypto / manual)
 * fall back to the manual provider.
 */
@Injectable()
export class PayoutProviderService {
  private readonly logger = new Logger('PayoutProviderService')
  private readonly registry: Record<string, PayoutProvider>

  constructor(
    private readonly stripe: StripePayoutProvider,
    private readonly wise: WisePayoutProvider,
    private readonly paypal: PayPalPayoutProvider,
    private readonly manual: ManualPayoutProvider,
  ) {
    this.registry = {
      stripe: this.stripe,
      wise: this.wise,
      paypal: this.paypal,
      manual: this.manual,
      // Non-automated rails route through the manual provider.
      bank: this.manual,
      crypto: this.manual,
    }
  }

  /** Returns the provider for a method, defaulting to manual. */
  forMethod(method: string): PayoutProvider {
    return this.registry[method] ?? this.manual
  }

  /** True if the method has a configured automated provider. */
  isAutomated(method: string): boolean {
    const p = this.registry[method]
    return !!p && p.method !== 'manual' && p.isConfigured()
  }

  async send(method: string, input: SendPayoutInput): Promise<SendPayoutResult> {
    const provider = this.forMethod(method)
    this.logger.log(`Dispatching payout ${input.payoutId} via ${provider.method} (method=${method})`)
    return provider.send(input)
  }
}
