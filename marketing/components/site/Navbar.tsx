'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { nav, loginUrl, signupUrl, site } from '@/lib/site'
import { Button } from './ui'

export function Navbar() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-bold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-black text-white">10x</span>
          <span className="text-lg">Affiliate</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm font-medium text-muted transition hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button href={loginUrl} variant="ghost" external>
            Log in
          </Button>
          <Button href={signupUrl} external>
            Start free
          </Button>
        </div>

        <button
          aria-label="Toggle menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-white md:hidden">
          <div className="space-y-1 px-5 py-3">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-brand-50"
                onClick={() => setOpen(false)}
              >
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2">
              <Button href={loginUrl} variant="outline" external className="flex-1">
                Log in
              </Button>
              <Button href={signupUrl} external className="flex-1">
                Start free
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
