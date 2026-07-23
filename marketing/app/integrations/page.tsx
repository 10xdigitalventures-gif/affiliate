import type { Metadata } from 'next'
import { ArrowRight, Store, Puzzle, Code2, Zap, Check } from 'lucide-react'
import { Container, Section, SectionHeading, Button, Card, Eyebrow } from '@/components/site/ui'
import { signupUrl } from '@/lib/site'

export const metadata: Metadata = { title: 'Integrations' }

const items = [
  { icon: Store, name: 'Shopify', tag: '1-click app', desc: 'Install the Shopify app and we auto-register webhooks and start tracking - no manual tokens or code.', points: ['OAuth 1-click install', 'Auto webhook registration', 'Uninstall auto-disconnect'] },
  { icon: Puzzle, name: 'WooCommerce', tag: 'Plugin (.zip)', desc: 'Upload our WordPress plugin, paste your API key, and it self-registers and syncs orders and refunds.', points: ['Self-registration', '60-day referral cookie', 'HPOS-compatible'] },
  { icon: Code2, name: 'Custom / Headless', tag: 'Snippet + API', desc: 'Drop a JS snippet on your site and report orders via REST for any stack or custom checkout.', points: ['Referral JS snippet', 'REST order ingest', 'Server-to-server postback'] },
  { icon: Zap, name: 'GoHighLevel', tag: 'Connector', desc: 'Connect GHL funnels and capture conversion events straight into your program.', points: ['Funnel conversions', 'Webhook capture', 'Coupon + link tracking'] },
]

export default function IntegrationsPage() {
  return (
    <>
      <Section className="border-b border-line bg-brand-50/40">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Integrations</Eyebrow>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Connect any store in minutes</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">Whether you are on Shopify, WooCommerce, a custom build or GoHighLevel - we have a clean path in.</p>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-6 md:grid-cols-2">
            {items.map((it) => (
              <Card key={it.name} className="flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand"><it.icon size={22} /></div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">{it.name}</h3>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand">{it.tag}</span>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted">{it.desc}</p>
                <ul className="mt-4 space-y-2">
                  {it.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm text-ink"><Check size={15} className="text-brand" />{p}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button href={signupUrl} external size="lg">Connect your store <ArrowRight size={18} /></Button>
          </div>
        </Container>
      </Section>
    </>
  )
}
