'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, setTokens, TwoFactor, Sso } from '@/lib/api'
import { Button } from '@/components/ui/button'

type LoginUser = { permissions: string[]; affiliateId?: string | null }
type Workspace = { slug: string; name: string }
type LoginResponse =
  | { access_token: string; refresh_token: string; user: LoginUser }
  | { twoFactorRequired: true; challenge: string }
  // Returned when the address exists in several workspaces and the request
  // carried no workspace hint. The password has already been verified at this
  // point; the challenge only picks which of those accounts to sign in as.
  | { workspaceSelectionRequired: true; challenge: string; workspaces: Workspace[] }

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@demo.test')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 2FA step state
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')

  // Workspace-selection step state
  const [wsChallenge, setWsChallenge] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  // SSO step state
  const [ssoSlug, setSsoSlug] = useState('')
  const [showSso, setShowSso] = useState(false)

  useEffect(() => {
    // Surface an SSO error bounced back from the callback (?ssoError=...).
    const params = new URLSearchParams(window.location.search)
    const e = params.get('ssoError')
    if (e) setError(decodeURIComponent(e))
  }, [])

  function routeByUser(user: LoginUser) {
    if (user.affiliateId && user.permissions.length === 0) router.push('/portal')
    else router.push('/dashboard')
  }

  /** Shared handling of every /auth/login and /auth/select-workspace reply. */
  function handleLoginResponse(res: LoginResponse) {
    if ('workspaceSelectionRequired' in res) {
      setWsChallenge(res.challenge)
      setWorkspaces(res.workspaces)
      return
    }
    if ('twoFactorRequired' in res) {
      setWsChallenge(null)
      setChallenge(res.challenge)
      return
    }
    setTokens(res.access_token, res.refresh_token)
    window.localStorage.setItem('user', JSON.stringify(res.user))
    routeByUser(res.user)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      // No orgSlug is sent: the API resolves the workspace from the login
      // domain or subdomain, and asks below only if it genuinely cannot tell.
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      handleLoginResponse(res)
    } catch (err) {
      setError((err as Error).message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function chooseWorkspace(orgSlug: string) {
    if (!wsChallenge) return
    setLoading(true)
    setError(null)
    try {
      const res = await api<LoginResponse>('/auth/select-workspace', {
        method: 'POST',
        body: JSON.stringify({ challenge: wsChallenge, orgSlug }),
      })
      handleLoginResponse(res)
    } catch (err) {
      setError((err as Error).message || 'Could not open that workspace')
    } finally {
      setLoading(false)
    }
  }

  async function verify2fa(e: React.FormEvent) {
    e.preventDefault()
    if (!challenge) return
    setLoading(true)
    setError(null)
    try {
      const res = await TwoFactor.verify(challenge, code.trim())
      window.localStorage.setItem('user', JSON.stringify(res.user))
      routeByUser(res.user as LoginUser)
    } catch (err) {
      setError((err as Error).message || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  async function startSso(e: React.FormEvent) {
    e.preventDefault()
    if (!ssoSlug.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { url } = await Sso.authorizeUrl(ssoSlug.trim().toLowerCase(), window.location.origin)
      window.location.href = url
    } catch (err) {
      setError((err as Error).message || 'SSO is not available for that workspace')
      setLoading(false)
    }
  }

  const inputCls =
    'w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand'

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-xs rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
          <span className="font-semibold text-sm">Affiliate</span>
        </div>

        {wsChallenge ? (
          <div>
            <h1 className="text-base font-semibold">Choose a workspace</h1>
            <p className="text-xs text-muted mb-4">
              This email is used in more than one workspace. Pick the one to sign in to.
            </p>
            <ul className="mb-3 space-y-1.5">
              {workspaces.map((w) => (
                <li key={w.slug}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => chooseWorkspace(w.slug)}
                    className="w-full rounded-md border border-line px-2.5 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-60"
                  >
                    <span className="block font-medium">{w.name}</span>
                    <span className="block text-2xs text-muted">{w.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <button
              type="button"
              onClick={() => { setWsChallenge(null); setWorkspaces([]); setError(null) }}
              className="mt-1 w-full text-2xs text-muted hover:text-ink"
            >
              Back to sign in
            </button>
          </div>
        ) : challenge ? (
          <form onSubmit={verify2fa}>
            <h1 className="text-base font-semibold">Two-factor authentication</h1>
            <p className="text-xs text-muted mb-4">
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </p>
            <input
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              placeholder="123456"
              className={inputCls + ' mb-4 tracking-widest text-center'}
            />
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">
              {loading ? 'Verifying\u2026' : 'Verify'}
            </Button>
            <button
              type="button"
              onClick={() => { setChallenge(null); setCode(''); setError(null) }}
              className="mt-3 w-full text-2xs text-muted hover:text-ink"
            >
              Back to sign in
            </button>
          </form>
        ) : showSso ? (
          <form onSubmit={startSso}>
            <h1 className="text-base font-semibold">Sign in with SSO</h1>
            <p className="text-xs text-muted mb-4">Enter your workspace ID to continue to your identity provider.</p>
            <label className="block text-xs text-muted mb-1">Workspace</label>
            <input
              autoFocus
              value={ssoSlug}
              onChange={(ev) => setSsoSlug(ev.target.value)}
              placeholder="acme"
              className={inputCls + ' mb-4'}
            />
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">
              {loading ? 'Redirecting\u2026' : 'Continue with SSO'}
            </Button>
            <button
              type="button"
              onClick={() => { setShowSso(false); setError(null) }}
              className="mt-3 w-full text-2xs text-muted hover:text-ink"
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-base font-semibold">Sign in</h1>
            <p className="text-xs text-muted mb-4">Welcome back</p>
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls + ' mb-3'}
            />
            <label className="block text-xs text-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls + ' mb-4'}
            />
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">
              {loading ? 'Signing in\u2026' : 'Sign in'}
            </Button>
            <button
              type="button"
              onClick={() => { setShowSso(true); setError(null) }}
              className="mt-2 w-full rounded-md border border-line py-1.5 text-sm hover:bg-gray-50"
            >
              Sign in with SSO
            </button>
            <p className="text-2xs text-muted mt-3 text-center">
              Admin: admin@demo.test · Affiliate: affiliate@demo.test · password123
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
