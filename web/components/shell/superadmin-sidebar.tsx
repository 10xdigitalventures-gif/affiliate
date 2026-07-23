'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Building2, Package, CreditCard, ArrowLeft } from 'lucide-react'

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/tenants', label: 'Tenants', icon: Building2 },
  { href: '/admin/plans', label: 'Plans', icon: Package },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard },
]

export function SuperAdminSidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden lg:flex w-48 shrink-0 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line">
        <div className="h-5 w-5 rounded-md bg-ink" aria-hidden />
        <span className="font-semibold text-sm">Platform</span>
      </div>
      <nav className="flex-1 p-1.5 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
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
      <div className="p-1.5 border-t border-line">
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-gray-50">
          <ArrowLeft size={15} strokeWidth={2} />
          Back to app
        </Link>
      </div>
    </aside>
  )
}
