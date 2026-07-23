'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { Plan } from '@/lib/plans'
import { signupUrl } from '@/lib/site'
import { Button } from './ui'

export function PricingCards({ plans }: { plans: Plan[] }) {
  const [annual, setAnnual] = useState(true)
  return (
    <div>
      <div className="flex items-center justify-center gap-3">
        <span className={'text-sm font-medium ' + (!annual ? 'text-ink' : 'text-muted')}>Monthly</span>
        <button
          role="switch"
          aria-checked={annual}
          onClick={() => setAnnual((v) => !v)}
          className={'relative h-7 w-12 rounded-full transition ' + (annual ? 'bg-brand' : 'bg-line')}
        >
          <span
            className={'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ' + (annual ? 'left-6' : 'left-1')}
          />
        </button>
        <span className={'text-sm font-medium ' + (annual ? 'text-ink' : 'text-muted')}>
          Annual <span className="text-brand">(save 20%)</span>
        </span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {plans.map((p) => {
          const price = annual ? p.annual : p.monthly
          return (
            <div
              key={p.id}
              className={
                'relative flex flex-col rounded-2xl border bg-white p-7 ' +
                (p.featured ? 'border-brand shadow-lift ring-1 ring-brand' : 'border-line shadow-card')
              }
            >
              {p.featured ? (
                <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-lg font-bold text-ink">{p.name}</h3>
              {p.tagline ? <p className="mt-1 text-sm text-muted">{p.tagline}</p> : null}
              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-ink">
                  {price === 0 ? 'Free' : '$' + price}
                </span>
                {price !== 0 ? <span className="pb-1 text-sm text-muted">/mo</span> : null}
              </div>
              {price !== 0 && annual ? (
                <p className="mt-1 text-xs text-muted">billed annually</p>
              ) : (
                <p className="mt-1 text-xs text-transparent">.</p>
              )}
              <Button href={signupUrl} external variant={p.featured ? 'primary' : 'outline'} className="mt-6 w-full">
                {p.cta || 'Get started'}
              </Button>
              <ul className="mt-7 space-y-3">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                    <Check size={16} className="mt-0.5 shrink-0 text-brand" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
