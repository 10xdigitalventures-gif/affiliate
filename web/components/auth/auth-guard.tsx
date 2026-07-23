'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Auth, AuthUser, setTokens } from '@/lib/api'

type Area = 'dashboard' | 'portal' | 'superadmin' | 'authenticated'

function landingPage(user: AuthUser) {
  const affiliateOnly = Boolean(user.affiliateId) && (user.permissions?.length ?? 0) === 0
  if (user.isSuperAdmin) return '/admin'
  return affiliateOnly ? '/portal' : '/dashboard'
}

export function AuthGuard({
  children,
  area = 'authenticated',
}: {
  children: React.ReactNode
  area?: Area
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true

    async function verify() {
      try {
        const user: AuthUser = await Auth.me()

        if (!active) return
        window.localStorage.setItem('user', JSON.stringify(user))
        window.dispatchEvent(new CustomEvent('profile-updated', { detail: user }))

        const affiliateOnly = Boolean(user.affiliateId) && (user.permissions?.length ?? 0) === 0
        let redirectTo: string | null = null
        if (area === 'dashboard' && affiliateOnly) redirectTo = '/portal'
        if (area === 'portal' && !user.affiliateId) redirectTo = '/dashboard'
        if (area === 'superadmin' && !user.isSuperAdmin) redirectTo = landingPage(user)
        // A super admin can also be a tenant administrator in their own
        // organization. Allow that dual-role account into the tenant dashboard;
        // the platform console remains available from the account switcher.

        if (redirectTo) {
          router.replace(redirectTo)
          return
        }
        setReady(true)
      } catch {
        setTokens(null, null)
        window.localStorage.removeItem('user')
        router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      }
    }

    verify()
    return () => {
      active = false
    }
  }, [area, pathname, router])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
          <p className="mt-3 text-xs text-muted">Checking your session…</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
