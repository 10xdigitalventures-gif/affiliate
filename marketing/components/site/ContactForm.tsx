'use client'

import { useState } from 'react'

export function ContactForm() {
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' })

  const field =
    'w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30'

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Wire this to your backend / CRM endpoint at deploy time.
    setSent(true)
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-line bg-brand-50 p-8 text-center">
        <h3 className="text-lg font-bold text-ink">Thanks, {form.name || 'there'}! {'\uD83D\uDC4B'}</h3>
        <p className="mt-2 text-sm text-muted">We have received your message and will get back to you within one business day.</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Name</label>
          <input required className={field} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Work email</label>
          <input required type="email" className={field} placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Company</label>
        <input className={field} placeholder="Company / store name" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Message</label>
        <textarea required rows={5} className={field} placeholder="How can we help?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </div>
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white shadow-lift transition hover:bg-brand-600"
      >
        Send message
      </button>
    </form>
  )
}
