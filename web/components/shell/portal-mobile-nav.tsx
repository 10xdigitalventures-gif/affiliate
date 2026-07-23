'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PORTAL_NAV } from './portal-sidebar'

export function PortalMobileNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Partner portal navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white lg:hidden">
      <div className="flex overflow-x-auto px-1 py-1">
        {PORTAL_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex min-w-[76px] flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-[10px] ${active ? 'bg-surface font-medium text-brand' : 'text-muted'}`}
            >
              <Icon size={16} />
              <span className="whitespace-nowrap">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
