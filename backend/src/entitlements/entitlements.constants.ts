/**
 * Central catalog of plan feature flags and numeric limits.
 * Platform owners compose plans (packages) from these keys in the super-admin console.
 */

export const FEATURE_KEYS = [
  'apiAccess',
  'webhooks',
  'fraudTools',
  'multiTierCommissions',
  'advancedReports',
  'bulkOperations',
  'branding',
  'customDomain',
  'prioritySupport',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const LIMIT_KEYS = ['affiliates', 'stores', 'teamMembers', 'apiKeys'] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export interface Entitlements {
  features: Record<FeatureKey, boolean>
  limits: Record<LimitKey, number>
}

/** Denied-by-default baseline used when an org has no active subscription. */
export const FREE_FALLBACK: Entitlements = {
  features: {
    apiAccess: false,
    webhooks: false,
    fraudTools: false,
    multiTierCommissions: false,
    advancedReports: false,
    bulkOperations: false,
    branding: false,
    customDomain: false,
    prioritySupport: false,
  },
  limits: {
    affiliates: 5,
    stores: 1,
    teamMembers: 1,
    apiKeys: 0,
  },
}

/** Human-friendly labels for UI rendering. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  apiAccess: 'API access',
  webhooks: 'Webhooks',
  fraudTools: 'Fraud detection & review queue',
  multiTierCommissions: 'Multi-tier commissions',
  advancedReports: 'Advanced reports & analytics',
  bulkOperations: 'Bulk import / export',
  branding: 'Custom branding (white-label)',
  customDomain: 'Custom login domain',
  prioritySupport: 'Priority support',
}

export const LIMIT_LABELS: Record<LimitKey, string> = {
  affiliates: 'Affiliates',
  stores: 'Connected stores',
  teamMembers: 'Team members',
  apiKeys: 'API keys',
}

/**
 * Default packages seeded on a fresh install. Platform owners can edit / add more.
 * limit value -1 means unlimited.
 */
export const DEFAULT_PLANS: Array<{
  key: string
  name: string
  description: string
  priceCents: number
  interval: 'month' | 'year'
  sortOrder: number
  features: Record<FeatureKey, boolean>
  limits: Record<LimitKey, number>
}> = [
  {
    key: 'starter',
    name: 'Starter',
    description: 'For new programs getting off the ground.',
    priceCents: 4900,
    interval: 'month',
    sortOrder: 1,
    features: {
      apiAccess: false,
      webhooks: false,
      fraudTools: false,
      multiTierCommissions: false,
      advancedReports: false,
      bulkOperations: false,
      branding: false,
      customDomain: false,
      prioritySupport: false,
    },
    limits: { affiliates: 50, stores: 1, teamMembers: 2, apiKeys: 1 },
  },
  {
    key: 'growth',
    name: 'Growth',
    description: 'Scaling programs that need automation and insights.',
    priceCents: 14900,
    interval: 'month',
    sortOrder: 2,
    features: {
      apiAccess: true,
      webhooks: true,
      fraudTools: true,
      multiTierCommissions: true,
      advancedReports: true,
      bulkOperations: true,
      branding: true,
      customDomain: false,
      prioritySupport: false,
    },
    limits: { affiliates: 1000, stores: 5, teamMembers: 10, apiKeys: 5 },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale, white-label, and priority support.',
    priceCents: 49900,
    interval: 'month',
    sortOrder: 3,
    features: {
      apiAccess: true,
      webhooks: true,
      fraudTools: true,
      multiTierCommissions: true,
      advancedReports: true,
      bulkOperations: true,
      branding: true,
      customDomain: true,
      prioritySupport: true,
    },
    limits: { affiliates: -1, stores: -1, teamMembers: -1, apiKeys: -1 },
  },
]
