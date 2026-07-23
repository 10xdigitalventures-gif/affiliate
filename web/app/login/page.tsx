'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, Auth, setTokens, TwoFactor, Sso } from '@/lib/api'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

type LoginUser = { permissions: string[]; affiliateId?: string | null; isSuperAdmin?: boolean }
type LoginResponse =
  | { user: LoginUser }
  | { twoFactorRequired: true; challenge: string }
type SignInMode = 'email' | 'password' | 'sso'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<SignInMode>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  // Passwordless email-code state.
  const [emailChallenge, setEmailChallenge] = useState<string | null>(null)
  const [emailCode, setEmailCode] = useState('')
  const [sentTo, setSentTo] = useState('')

  // Authenticator-app 2FA remains an additional factor when enabled.
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const [ssoSlug, setSsoSlug] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoError = params.get('ssoError')
    if (ssoError) setError('SSO sign-in could not be completed. Please try email sign-in or contact your workspace administrator.')

    Auth.me()
      .then((user) => routeByUser(user))
      .catch(() => {
        setTokens(null, null)
        window.localStorage.removeItem('user')
        setCheckingSession(false)
      })
    // routeByUser is intentionally stable for this initial session check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function routeByUser(user: LoginUser) {
    const affiliateOnly = Boolean(user.affiliateId) && user.permissions.length === 0
    const requested = new URLSearchParams(window.location.search).get('next')
    const safeRequested = requested?.startsWith('/') && !requested.startsWith('//') ? requested : null
    if (safeRequested) {
      const allowed = user.isSuperAdmin
        ? safeRequested.startsWith('/admin')
        : affiliateOnly
          ? safeRequested.startsWith('/portal')
          : !safeRequested.startsWith('/portal') && !safeRequested.startsWith('/admin')
      if (allowed) {
        router.replace(safeRequested)
        return
      }
    }
    router.replace(user.isSuperAdmin ? '/admin' : affiliateOnly ? '/portal' : '/dashboard')
  }

  function finishLogin(user: LoginUser) {
    setTokens(null, null)
    window.localStorage.setItem('user', JSON.stringify(user))
    routeByUser(user)
  }

  async function sendEmailCode(event?: React.SyntheticEvent) {
    event?.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const result = await Auth.requestEmailCode(normalized)
      setEmailChallenge(result.challenge)
      setSentTo(normalized)
      setEmailCode('')
    } catch (err) {
      setError((err as Error).message || 'The sign-in code could not be sent')
    } finally {
      setLoading(false)
    }
  }

  async function verifyEmailCode(event: React.FormEvent) {
    event.preventDefault()
    if (!emailChallenge) return
    setLoading(true)
    setError(null)
    try {
      const result = await Auth.verifyEmailCode(emailChallenge, emailCode.trim())
      if ('twoFactorRequired' in result) {
        setEmailChallenge(null)
        setChallenge(result.challenge)
        return
      }
      finishLogin(result.user)
    } catch (err) {
      setError((err as Error).message || 'Invalid or expired sign-in code')
    } finally {
      setLoading(false)
    }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, workspace: workspace.trim().toLowerCase() || undefined }),
      })
      if ('twoFactorRequired' in result) {
        setChallenge(result.challenge)
        return
      }
      finishLogin(result.user)
    } catch (err) {
      setError((err as Error).message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function verify2fa(event: React.FormEvent) {
    event.preventDefault()
    if (!challenge) return
    setLoading(true)
    setError(null)
    try {
      const result = await TwoFactor.verify(challenge, code.trim())
      finishLogin(result.user as LoginUser)
    } catch (err) {
      setError((err as Error).message || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  async function startSso(event: React.FormEvent) {
    event.preventDefault()
    if (!ssoSlug.trim()) return
    setLoading(true)
    setError(null)
    try {
      const requested = new URLSearchParams(window.location.search).get('next')
      const next = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/'
      const { url } = await Sso.authorizeUrl(ssoSlug.trim().toLowerCase(), next)
      window.location.href = url
    } catch (err) {
      setError((err as Error).message || 'SSO is not available for that workspace')
      setLoading(false)
    }
  }

  function switchMode(nextMode: SignInMode) {
    setMode(nextMode)
    setEmailChallenge(null)
    setEmailCode('')
    setChallenge(null)
    setCode('')
    setError(null)
  }

  const inputCls = 'w-full rounded-md border border-line px-2.5 py-2 text-sm outline-none focus:border-brand'

  if (checkingSession) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
          <p className="mt-3 text-xs text-muted">Checking your session…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-xs rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
          <span className="text-sm font-semibold">Affiliate</span>
        </div>

        {challenge ? (
          <form onSubmit={verify2fa}>
            <h1 className="text-base font-semibold">Two-factor authentication</h1>
            <p className="mb-4 text-xs text-muted">Enter the code from your authenticator app, or a recovery code.</p>
            <input autoFocus inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" className={`${inputCls} mb-4 text-center tracking-widest`} />
            {error && <p className="mb-3 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">{loading ? 'Verifying…' : 'Verify'}</Button>
            <button type="button" onClick={() => switchMode('email')} className="mt-3 w-full text-2xs text-muted hover:text-ink">Back to email sign in</button>
          </form>
        ) : emailChallenge ? (
          <form onSubmit={verifyEmailCode}>
            <h1 className="text-base font-semibold">Check your email</h1>
            <p className="mb-4 text-xs text-muted">Enter the 6-digit code sent to <strong className="text-ink">{sentTo}</strong>.</p>
            <label className="mb-1 block text-xs text-muted">Sign-in code</label>
            <input
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={emailCode}
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className={`${inputCls} mb-4 text-center text-lg tracking-[0.35em]`}
            />
            {error && <p className="mb-3 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading || emailCode.length !== 6} className="w-full justify-center py-1.5">{loading ? 'Verifying…' : 'Verify and sign in'}</Button>
            <div className="mt-3 flex items-center justify-between text-2xs">
              <button type="button" onClick={() => { setEmailChallenge(null); setError(null) }} className="text-muted hover:text-ink">Change email</button>
              <button type="button" disabled={loading} onClick={sendEmailCode} className="text-brand disabled:opacity-50">Resend code</button>
            </div>
          </form>
        ) : mode === 'sso' ? (
          <form onSubmit={startSso}>
            <h1 className="text-base font-semibold">Sign in with SSO</h1>
            <p className="mb-4 text-xs text-muted">For organizations using an external identity provider.</p>
            <label className="mb-1 block text-xs text-muted">Workspace ID</label>
            <input autoFocus value={ssoSlug} onChange={(event) => setSsoSlug(event.target.value)} placeholder="workspace-name" className={`${inputCls} mb-4`} />
            {error && <p className="mb-3 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">{loading ? 'Redirecting…' : 'Continue with SSO'}</Button>
            <button type="button" onClick={() => switchMode('email')} className="mt-3 w-full text-2xs text-muted hover:text-ink">Back to email sign in</button>
          </form>
        ) : mode === 'password' ? (
          <form onSubmit={submitPassword}>
            <h1 className="text-base font-semibold">Sign in with password</h1>
            <p className="mb-4 text-xs text-muted">Use your existing account password.</p>
            <label className="mb-1 block text-xs text-muted">Email</label>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputCls} mb-3`} autoComplete="email" />
            <label className="mb-1 block text-xs text-muted">Workspace <span className="text-2xs">(optional)</span></label>
            <input value={workspace} onChange={(event) => setWorkspace(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={50} className={`${inputCls} mb-3`} placeholder="Only for shared emails" />
            <label className="mb-1 block text-xs text-muted">Password</label>
            <input required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputCls} mb-3`} autoComplete="current-password" />
            <div className="mb-3 text-right"><Link href="/forgot-password" className="text-2xs text-brand hover:underline">Forgot password?</Link></div>
            {error && <p className="mb-3 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">{loading ? 'Signing in…' : 'Sign in'}</Button>
            <button type="button" onClick={() => switchMode('email')} className="mt-3 w-full text-2xs text-muted hover:text-ink">Back to email code</button>
          </form>
        ) : (
          <form onSubmit={sendEmailCode}>
            <h1 className="text-base font-semibold">Sign in with email</h1>
            <p className="mb-4 text-xs text-muted">We will email you a secure 6-digit sign-in code.</p>
            <label className="mb-1 block text-xs text-muted">Email address</label>
            <input required autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputCls} mb-4`} autoComplete="email" placeholder="you@example.com" />
            {error && <p className="mb-3 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center py-1.5">{loading ? 'Sending code…' : 'Email me a login code'}</Button>
            <div className="mt-4 border-t border-line pt-3 text-center">
              <p className="mb-2 text-2xs text-muted">Other sign-in options</p>
              <div className="flex justify-center gap-3 text-2xs">
                <button type="button" onClick={() => switchMode('password')} className="text-brand hover:underline">Use password</button>
                <button type="button" onClick={() => switchMode('sso')} className="text-brand hover:underline">Enterprise SSO</button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
