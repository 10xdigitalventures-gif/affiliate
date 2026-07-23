import Link from 'next/link'
import { nav, site } from '@/lib/site'

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink text-white/80">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <Link href="/" className="flex items-center gap-2 font-bold text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-black text-white">10x</span>
            <span className="text-lg">Affiliate</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">{site.description}</p>
          <p className="mt-6 text-xs text-white/40">A product by {site.company}</p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white">Product</h4>
          <ul className="mt-4 space-y-2 text-sm">
            {nav.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="text-white/60 transition hover:text-white">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white">Get in touch</h4>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a href={'mailto:' + site.email} className="text-white/60 transition hover:text-white">
                {site.email}
              </a>
            </li>
            <li>
              <Link href="/contact" className="text-white/60 transition hover:text-white">
                Contact us
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-xs text-white/40 sm:flex-row sm:px-8">
          <p>© {new Date().getFullYear()} {site.company}. All rights reserved.</p>
          <p>Built for Shopify, WooCommerce &amp; custom stores.</p>
        </div>
      </div>
    </footer>
  )
}
