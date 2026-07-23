'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Auth, Sso } from '@/lib/api'

/**
 * The backend redirects here with a one-time exchange code. Real credentials
 * are delivered only through Secure + HttpOnly cookies.
 */
export default function SsoCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function run() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (!code) {
        setError('Missing sign-in code. Please try again.')
        return
      }
      try {
        const result = await Sso.exchange(code)
        window.history.replaceState(null, '', '/login/sso-callback')
        const me = result.user || await Auth.me()
        window.localStorage.setItem('user', JSON.stringify(me))
        if (me.isSuperAdmin) router.replace('/admin')
        else if (me.affiliateId && (me.permissions?.length ?? 0) === 0) router.replace('/portal')
        else router.replace('/dashboard')
      } catch (err) {
        setError((err as Error).message || 'Sign-in could not be completed.')
      }
    }
    run()
  }, [router])

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-xs rounded-lg border border-line bg-white p-5 shadow-card text-center">
        {error ? (
          <>
            <h1 className="text-base font-semibold">Sign-in failed</h1>
            <p className="text-xs text-danger mt-2">{error}</p>
            <a href="/login" className="mt-4 inline-block text-xs text-brand">Return to sign in</a>
          </>
        ) : (
          <>
            <div className="mx-auto h-6 w-6 rounded-full border-2 border-line border-t-brand animate-spin" aria-hidden />
            <p className="text-sm mt-3">Signing you in\u2026</p>
          </>
        )}
      </div>
    </div>
  )
}
