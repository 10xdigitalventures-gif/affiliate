'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Link2, ShoppingCart, Wallet, Banknote, FileText, TicketPercent } from 'lucide-react'

export const PORTAL_NAV = [
  { href: '/portal', label: 'Overview', icon: LayoutDashboard },
  { href: '/portal/links', label: 'My links', icon: Link2 },
  { href: '/portal/coupons', label: 'Coupons & offers', icon: TicketPercent },
  { href: '/portal/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/portal/earnings', label: 'Earnings', icon: Wallet },
  { href: '/portal/payouts', label: 'Payouts', icon: Banknote },
  { href: '/portal/tax', label: 'Tax', icon: FileText },
]

export function PortalSidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden lg:flex w-48 shrink-0 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line">
        <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
        <span className="font-semibold text-sm">Partner portal</span>
      </div>
      <nav className="flex-1 p-1.5 space-y-0.5">
        {PORTAL_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition cursor-pointer ${
                active ? 'bg-surface text-brand font-medium' : 'text-muted hover:bg-gray-50'
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
