import type { Metadata } from 'next'
import { Container, Section, SectionHeading, Button, Card, Eyebrow } from '@/components/site/ui'
import { site, signupUrl } from '@/lib/site'
import { stats } from '@/lib/content'

export const metadata: Metadata = { title: 'About' }

const values = [
  { title: 'Own your data', body: 'First-party tracking and transparent attribution - your program, your numbers.' },
  { title: 'Fair by design', body: 'Pay partners what each sale is truly worth, including paid-vs-organic differences.' },
  { title: 'Built for everyone', body: 'From a solo store to an agency running programs for many clients under one brand.' },
]

export default function AboutPage() {
  return (
    <>
      <Section className="border-b border-line bg-brand-50/40">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>About us</Eyebrow>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">A modern affiliate platform, from {site.company}</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">We build practical growth tools for ecommerce brands and agencies. {site.name} is our take on affiliate marketing done right - powerful, fair and easy to run.</p>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <SectionHeading center={false} eyebrow="Our mission" title="Make affiliate growth accessible" subtitle="Enterprise affiliate tools cost a fortune and still miss modern tracking. We set out to give growing brands the same power - with first-party tracking, paid-vs-organic commissions and automated payouts - at a fair price." />
            </div>
            <div className="grid grid-cols-2 gap-6 rounded-3xl border border-line bg-brand-50/40 p-8">
              {stats.map((s) => (
                <div key={s.label}>
                  <div className="text-3xl font-extrabold text-ink">{s.value}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section className="bg-brand-50/40">
        <Container>
          <SectionHeading eyebrow="What we value" title="Principles behind the product" />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {values.map((v) => (
              <Card key={v.title}>
                <h3 className="text-lg font-bold text-ink">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{v.body}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button href={signupUrl} external size="lg">Get started free</Button>
          </div>
        </Container>
      </Section>
    </>
  )
}
