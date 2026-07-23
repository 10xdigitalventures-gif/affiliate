import type { Metadata } from 'next'
import { ArrowRight, Check, MousePointerClick, Ticket, Image as ImageIcon, Code2, Server, Webhook, Repeat, Megaphone } from 'lucide-react'
import { Container, Section, SectionHeading, Button, Card, Eyebrow } from '@/components/site/ui'
import { FeatureIcon } from '@/components/site/FeatureIcon'
import { features } from '@/lib/content'
import { signupUrl } from '@/lib/site'

export const metadata: Metadata = { title: 'Features' }

const tracking = [
  { icon: MousePointerClick, title: 'Referral link clicks', body: 'Short branded links record every click with device, UTM, geo and channel, then set a 60-day cookie.' },
  { icon: Ticket, title: 'Coupon / promo codes', body: 'Customers who arrive directly and enter a partner code are attributed - even without a click.' },
  { icon: ImageIcon, title: 'Tracking pixel', body: 'A cookieless 1x1 pixel records a visit on any landing page where a link is not possible.' },
  { icon: Code2, title: 'JS click beacon', body: 'A tiny snippet posts clicks and sets cookies for custom and headless storefronts.' },
  { icon: Server, title: 'Server-to-server postback', body: 'Advertisers fire conversions from their own server when browser cookies are unavailable.' },
  { icon: Webhook, title: 'Order webhooks / API', body: 'Shopify, WooCommerce and REST ingest send orders with referral, coupon and channel data.' },
  { icon: Repeat, title: 'Lifetime attribution', body: 'A customer keeps crediting the partner who first referred them on all future orders.' },
  { icon: Megaphone, title: 'Paid vs organic channel', body: 'Ad click-ids (gclid, fbclid, ttclid) and utm_medium detect paid traffic for source-based rates.' },
]

const commissions = [
  'Percentage, fixed, tiered and recurring commissions',
  'Per-product and per-category overrides',
  'Paid-vs-organic differential rates on coupon sales',
  'Multi-tier / sub-affiliate overrides with depth and decay',
  'Rule priority: affiliate > product > category > store > campaign > global',
  'Auto-reversal on refunds, with a clean pending / approved / paid ledger',
]

export default function FeaturesPage() {
  return (
    <>
      <Section className="border-b border-line bg-brand-50/40">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Features</Eyebrow>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Built for serious affiliate programs</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">Enterprise-grade tracking, flexible commissions and automated payouts - on any store, under your brand.</p>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading eyebrow="Tracking" title="8 ways we track every conversion" subtitle="Not just checkout coupons - we cover the whole funnel so you never lose attribution." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tracking.map((t) => (
              <Card key={t.title}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                  <t.icon size={20} />
                </div>
                <h3 className="mt-4 text-base font-bold text-ink">{t.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-brand-50/40">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow>Commissions</Eyebrow>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Pay exactly what each sale is worth</h2>
              <p className="mt-4 text-muted">A commission engine flexible enough for any program, with sensible defaults so you can launch fast.</p>
            </div>
            <ul className="space-y-3">
              {commissions.map((c) => (
                <li key={c} className="flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-sm text-ink shadow-card">
                  <Check size={18} className="mt-0.5 shrink-0 text-brand" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading eyebrow="And more" title="Everything else you would expect" />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <Card key={f.title}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                  <FeatureIcon name={f.icon} size={20} />
                </div>
                <h3 className="mt-4 text-base font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button href={signupUrl} external size="lg">Start free <ArrowRight size={18} /></Button>
          </div>
        </Container>
      </Section>
    </>
  )
}
