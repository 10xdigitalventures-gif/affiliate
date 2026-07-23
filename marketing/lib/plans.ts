import { site } from './site'

export type Plan = {
  id: string
  name: string
  tagline?: string
  monthly: number
  annual: number
  currency: string
  featured?: boolean
  cta?: string
  features: string[]
}

// Static fallback \u2014 used when the live plans API is unavailable. The Pricing
// page tries GET {API}/v1/public/plans first so admin-configured plans win.
export const FALLBACK_PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For new brands launching a program',
    monthly: 0,
    annual: 0,
    currency: 'USD',
    cta: 'Start free',
    features: [
      '1 store (Shopify / WooCommerce / custom)',
      'Unlimited affiliates',
      'Up to 200 tracked conversions / mo',
      'Referral links + coupon tracking',
      'Manual payouts',
      'Email + in-app notifications',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For brands scaling their partners',
    monthly: 49,
    annual: 39,
    currency: 'USD',
    featured: true,
    cta: 'Start 14-day trial',
    features: [
      'Everything in Starter, plus',
      'Up to 5 stores',
      'Unlimited tracked conversions',
      'Paid vs organic commission rules',
      'Multi-tier / sub-affiliates',
      'Auto payouts (PayPal, Wise, Stripe)',
      'Fraud protection + reports',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'For high-volume, multi-brand programs',
    monthly: 149,
    annual: 119,
    currency: 'USD',
    cta: 'Talk to sales',
    features: [
      'Everything in Growth, plus',
      'Unlimited stores',
      'White-label + custom domain',
      'Product & category commission overrides',
      'API access + S2S postback',
      'Priority support + onboarding',
    ],
  },
]

export async function getPlans(): Promise<{ plans: Plan[]; live: boolean }> {
  try {
    const res = await fetch(site.apiUrl + '/v1/public/plans', {
      next: { revalidate: 300 },
    })
    if (res.ok) {
      const data = (await res.json()) as { plans?: Plan[] }
      if (data && Array.isArray(data.plans) && data.plans.length) {
        return { plans: data.plans, live: true }
      }
    }
  } catch {
    // ignore \u2014 fall back to static plans
  }
  return { plans: FALLBACK_PLANS, live: false }
}
