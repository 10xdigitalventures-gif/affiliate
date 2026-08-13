export const site = {
  name: '10x Affiliate',
  company: '10x Digital Ventures',
  tagline: 'The affiliate & referral platform that powers 10X growth',
  description:
    'Launch, track and scale your affiliate, influencer and referral program on any store \u2014 Shopify, WooCommerce or custom. First-party tracking, flexible commissions, automated payouts.',
  email: 'hello@10xaffiliate.com',
  // App (dashboard) + API base. Override with env at deploy time.
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://app.10xaffiliate.com',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'https://api.10xaffiliate.com',
}

export const loginUrl = site.appUrl + '/login'
export const signupUrl = site.appUrl + '/login'

export const nav = [
  { label: 'Features', href: '/features' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
]
