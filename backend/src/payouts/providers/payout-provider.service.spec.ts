import { PayoutProviderService } from './payout-provider.service'
import { StripePayoutProvider } from './stripe.provider'
import { WisePayoutProvider } from './wise.provider'
import { PayPalPayoutProvider } from './paypal.provider'
import { ManualPayoutProvider } from './manual.provider'

describe('PayoutProviderService', () => {
  const svc = new PayoutProviderService(
    new StripePayoutProvider(),
    new WisePayoutProvider(),
    new PayPalPayoutProvider(),
    new ManualPayoutProvider(),
  )

  it('routes stripe/wise to their providers', () => {
    expect(svc.forMethod('stripe').method).toBe('stripe')
    expect(svc.forMethod('wise').method).toBe('wise')
  })

  it('routes non-automated rails to manual', () => {
    expect(svc.forMethod('bank').method).toBe('manual')
    expect(svc.forMethod('paypal').method).toBe('manual')
    expect(svc.forMethod('crypto').method).toBe('manual')
    expect(svc.forMethod('manual').method).toBe('manual')
    expect(svc.forMethod('unknown').method).toBe('manual')
  })

  it('manual provider returns processing (no money moved)', async () => {
    const res = await svc.send('manual', {
      payoutId: 'p1', amount: 10, currency: 'USD', destination: {},
    })
    expect(res.status).toBe('processing')
    expect(res.reference).toBeNull()
  })

  it('stripe fails cleanly without an acct_ destination', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    const res = await svc.send('stripe', {
      payoutId: 'p2', amount: 10, currency: 'USD', destination: {},
    })
    expect(res.status).toBe('failed')
    delete process.env.STRIPE_SECRET_KEY
  })

  it('isAutomated reflects configuration', () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(svc.isAutomated('stripe')).toBe(false)
    expect(svc.isAutomated('manual')).toBe(false)
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    expect(svc.isAutomated('stripe')).toBe(true)
    delete process.env.STRIPE_SECRET_KEY
  })
})
