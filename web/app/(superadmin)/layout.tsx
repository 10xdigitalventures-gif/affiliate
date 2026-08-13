'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Auth } from '@/lib/api'
import { SuperAdminSidebar } from '@/components/shell/superadmin-sidebar'

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading')

  useEffect(() => {
    Auth.me()
      .then((u) => setState(u.isSuperAdmin ? 'ok' : 'denied'))
      .catch(() => setState('denied'))
  }, [])

  if (state === 'loading') {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">Checking access...</div>
  }
  if (state === 'denied') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-lg font-semibold">Super-admin access required</h1>
        <p className="text-sm text-muted">This console is only available to platform owners.</p>
        <Link href="/dashboard" className="text-sm font-medium text-brand hover:underline">Back to your dashboard</Link>
      </div>
    )
  }
  return (
    <div className="flex h-screen">
      <SuperAdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-2 px-4 h-12 border-b border-line bg-white">
          <span className="text-sm font-medium">Platform console</span>
          <span className="rounded bg-ink/5 px-2 py-0.5 text-2xs font-medium text-muted">Super admin</span>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  )
}
