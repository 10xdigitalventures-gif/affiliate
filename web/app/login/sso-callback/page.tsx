'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Auth, setTokens } from '@/lib/api'

/**
 * The backend SSO callback issues tokens then redirects the browser here with
 * them in the URL fragment (#access_token=...&refresh_token=...). We stash the
 * tokens, hydrate the user, and route to the right home.
 */
export default function SsoCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function run() {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
      const params = new URLSearchParams(hash)
      const access = params.get('access_token')
      const refresh = params.get('refresh_token')
      if (!access || !refresh) {
        setError('Missing sign-in tokens. Please try again.')
        return
      }
      setTokens(access, refresh)
      // Clean the fragment so tokens are not left in history.
      window.history.replaceState(null, '', '/login/sso-callback')
      try {
        const me = await Auth.me()
        window.localStorage.setItem('user', JSON.stringify(me))
        if (me.affiliateId && (me.permissions?.length ?? 0) === 0) router.replace('/portal')
        else router.replace('/dashboard')
      } catch {
        // Even if /me fails we have tokens; send to dashboard which will re-check.
        router.replace('/dashboard')
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
