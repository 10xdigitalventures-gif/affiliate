import type { Metadata } from 'next'
import { Mail, MessageSquare, Clock } from 'lucide-react'
import { Container, Section, Eyebrow } from '@/components/site/ui'
import { ContactForm } from '@/components/site/ContactForm'
import { site } from '@/lib/site'

export const metadata: Metadata = { title: 'Contact' }

export default function ContactPage() {
  return (
    <Section className="bg-brand-50/40">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>Contact</Eyebrow>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Let us talk</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">Questions about features, pricing or migrating your program? Send us a note and we will reply within one business day.</p>
            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand shadow-card"><Mail size={18} /></div>
                <div>
                  <div className="text-sm font-semibold text-ink">Email</div>
                  <a href={'mailto:' + site.email} className="text-sm text-muted hover:text-brand">{site.email}</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand shadow-card"><MessageSquare size={18} /></div>
                <div>
                  <div className="text-sm font-semibold text-ink">Sales &amp; demos</div>
                  <div className="text-sm text-muted">Book a walkthrough of the platform</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand shadow-card"><Clock size={18} /></div>
                <div>
                  <div className="text-sm font-semibold text-ink">Response time</div>
                  <div className="text-sm text-muted">Within 1 business day</div>
                </div>
              </div>
            </div>
          </div>
          <ContactForm />
        </div>
      </Container>
    </Section>
  )
}
