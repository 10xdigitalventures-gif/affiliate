import Link from 'next/link'
import { ArrowRight, Check, Sparkles, Store, Puzzle, Code2, Zap } from 'lucide-react'
import { Container, Section, SectionHeading, Button, Card, Eyebrow } from '@/components/site/ui'
import { FeatureIcon } from '@/components/site/FeatureIcon'
import { Faq } from '@/components/site/Faq'
import { PricingCards } from '@/components/site/PricingCards'
import { getPlans } from '@/lib/plans'
import { stats, steps, features, integrations, testimonials, faqs } from '@/lib/content'
import { signupUrl, loginUrl, site } from '@/lib/site'

export default async function HomePage() {
  const { plans } = await getPlans()
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line bg-white">
        <div className="pointer-events-none absolute inset-0 bg-grid-faint bg-[size:44px_44px] opacity-60" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand-100 blur-3xl opacity-60" />
        <Container className="relative py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-brand shadow-card">
              <Sparkles size={14} /> Paid-vs-organic commissions, built in
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-6xl">
              The affiliate platform that powers{' '}
              <span className="text-brand">10X growth</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
              Launch, track and scale your affiliate, influencer and referral program on any store — Shopify,
              WooCommerce or custom. First-party tracking, flexible commissions and automated payouts.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href={signupUrl} external size="lg">
                Start free <ArrowRight size={18} />
              </Button>
              <Button href="/pricing" variant="outline" size="lg">
                See pricing
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted">No credit card required • Free plan forever</p>
          </div>

          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-extrabold text-ink">{s.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="Launch your program in 3 simple steps"
            subtitle="From connecting a store to paying partners — no engineering team required."
          />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <Card key={s.n} className="relative">
                <span className="text-sm font-black text-brand">{s.n}</span>
                <h3 className="mt-3 text-lg font-bold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* Features */}
      <Section className="bg-surface/60 bg-brand-50/40">
        <Container>
          <SectionHeading
            eyebrow="Features"
            title="Everything you need to run a serious program"
            subtitle="The depth of an enterprise tool, priced for growing brands."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-white p-6 shadow-card transition hover:shadow-lift">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                  <FeatureIcon name={f.icon} size={20} />
                </div>
                <h3 className="mt-4 text-base font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button href="/features" variant="outline">
              Explore all features <ArrowRight size={16} />
            </Button>
          </div>
        </Container>
      </Section>

      {/* Paid vs organic highlight */}
      <Section>
        <Container>
          <div className="grid items-center gap-10 rounded-3xl border border-line bg-ink p-8 text-white sm:p-12 lg:grid-cols-2">
            <div>
              <Eyebrow>Unique to 10x</Eyebrow>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Pay less for paid traffic, more for organic
              </h2>
              <p className="mt-4 text-white/70">
                When a sale comes through a partner’s coupon code, we automatically detect whether the customer arrived
                from a paid ad or organic reach — and apply the exact commission rate you set. Referral-link sales stay
                on your normal rules.
              </p>
              <div className="mt-6">
                <Button href="/features" variant="white">
                  How tracking works <ArrowRight size={16} />
                </Button>
              </div>
            </div>
            <div className="grid gap-4">
              <div className="rounded-2xl bg-white/10 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Coupon sale — organic</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs">10% commission</span>
                </div>
                <p className="mt-2 text-xs text-white/60">Customer found the creator naturally and used their code.</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Coupon sale — paid ad</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs">5% commission</span>
                </div>
                <p className="mt-2 text-xs text-white/60">You ran the creator’s video as an ad — lower rate applies.</p>
              </div>
              <div className="rounded-2xl bg-brand p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Referral link sale</span>
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs">Your normal rate</span>
                </div>
                <p className="mt-2 text-xs text-white/80">Untouched — the partner drove the click themselves.</p>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* Integrations */}
      <Section className="bg-brand-50/40">
        <Container>
          <SectionHeading
            eyebrow="Integrations"
            title="Works with your store, however you built it"
            subtitle="One-click apps, installable plugins, or a simple snippet for any custom stack."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {integrations.map((it, i) => {
              const icons = [Store, Puzzle, Code2, Zap]
              const Ico = icons[i % icons.length]
              return (
                <Card key={it.name}>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                    <Ico size={20} />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="text-base font-bold text-ink">{it.name}</h3>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand">{it.tag}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{it.desc}</p>
                </Card>
              )
            })}
          </div>
        </Container>
      </Section>

      {/* Testimonials */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Loved by operators" title="Brands and agencies scale with 10x Affiliate" />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <Card key={t.name}>
                <p className="text-sm leading-relaxed text-ink">“{t.quote}”</p>
                <div className="mt-5 border-t border-line pt-4">
                  <div className="text-sm font-semibold text-ink">{t.name}</div>
                  <div className="text-xs text-muted">{t.role}</div>
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* Pricing */}
      <Section id="pricing" className="bg-brand-50/40">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Simple, transparent pricing"
            subtitle="Start free. Upgrade as your program grows. Cancel anytime."
          />
          <div className="mt-12">
            <PricingCards plans={plans} />
          </div>
          <p className="mt-8 text-center text-sm text-muted">
            Need something custom?{' '}
            <Link href="/contact" className="font-semibold text-brand hover:underline">
              Talk to us
            </Link>
            .
          </p>
        </Container>
      </Section>

      {/* FAQ */}
      <Section>
        <Container>
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
          <div className="mt-12">
            <Faq items={faqs} />
          </div>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section className="pb-24">
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-brand px-8 py-14 text-center text-white sm:px-16">
            <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to launch your program?</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/80">
              Join brands scaling revenue with partners. Set up in an afternoon, not a sprint.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href={signupUrl} external variant="white" size="lg">
                Start free <ArrowRight size={18} />
              </Button>
              <Button href={loginUrl} external variant="ghost" size="lg" className="text-white hover:bg-white/10">
                Log in
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </>
  )
}
