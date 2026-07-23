'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line bg-white">
      {items.map((it, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="px-5">
            <button
              className="flex w-full items-center justify-between gap-4 py-5 text-left"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="text-base font-semibold text-ink">{it.q}</span>
              <ChevronDown
                size={18}
                className={'shrink-0 text-muted transition-transform ' + (isOpen ? 'rotate-180' : '')}
              />
            </button>
            {isOpen ? <p className="pb-5 text-sm leading-relaxed text-muted">{it.a}</p> : null}
          </div>
        )
      })}
    </div>
  )
}
