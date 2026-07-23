import type { Metadata } from 'next'
import Link from 'next/link'
import { Container, Section, SectionHeading, Eyebrow } from '@/components/site/ui'
import { PricingCards } from '@/components/site/PricingCards'
import { Faq } from '@/components/site/Faq'
import { getPlans } from '@/lib/plans'
import { faqs } from '@/lib/content'

export const metadata: Metadata = { title: 'Pricing' }

export default async function PricingPage() {
  const { plans } = await getPlans()
  return (
    <>
      <Section className="border-b border-line bg-brand-50/40">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Simple pricing that scales with you</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">Start free. Upgrade as your program grows. No hidden fees, cancel anytime.</p>
          </div>
          <div className="mt-12">
            <PricingCards plans={plans} />
          </div>
          <p className="mt-8 text-center text-sm text-muted">All plans include unlimited affiliates and core tracking. Need a custom plan? <Link href="/contact" className="font-semibold text-brand hover:underline">Talk to sales</Link>.</p>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading eyebrow="FAQ" title="Pricing questions" />
          <div className="mt-12"><Faq items={faqs} /></div>
        </Container>
      </Section>
    </>
  )
}
