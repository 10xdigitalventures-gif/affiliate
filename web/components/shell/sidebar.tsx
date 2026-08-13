'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Store, ShoppingCart, Wallet, BarChart3, Settings, Link2, ShieldAlert, Package, Megaphone, CreditCard, FileText,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/affiliates', label: 'Affiliates', icon: Users },
  { href: '/stores', label: 'Stores', icon: Store },
  { href: '/catalog', label: 'Catalog', icon: Package },
  { href: '/marketing', label: 'Links & Coupons', icon: Megaphone },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/commissions', label: 'Commissions', icon: Link2 },
  { href: '/payouts', label: 'Payouts', icon: Wallet },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/fraud', label: 'Fraud', icon: ShieldAlert },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/tax', label: 'Tax & 1099', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden lg:flex w-48 shrink-0 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line">
        <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
        <span className="font-semibold text-sm">Affiliate</span>
      </div>
      <nav className="flex-1 p-1.5 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
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
