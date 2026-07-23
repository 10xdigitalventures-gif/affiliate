'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Auth } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '')
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) return setError('This invitation link is missing its token.')
    if (password !== confirmPassword) return setError('Passwords do not match.')

    setBusy(true)
    try {
      const result = await Auth.acceptInvite(token, password, fullName.trim() || undefined)
      window.localStorage.setItem('user', JSON.stringify(result.user))
      if (result.user.isSuperAdmin) router.replace('/admin')
      else if (result.user.affiliateId && result.user.permissions.length === 0) router.replace('/portal')
      else router.replace('/dashboard')
    } catch (err) {
      setError((err as Error).message || 'Could not accept this invitation.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass = 'mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand'

  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
          <span className="text-sm font-semibold">Join your workspace</span>
        </div>
        <h1 className="text-base font-semibold">Accept invitation</h1>
        <p className="mb-4 text-xs text-muted">Set your profile and password to open your team portal.</p>

        <label className="mb-3 block text-xs text-muted">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} autoComplete="name" />
        </label>
        <label className="mb-3 block text-xs text-muted">
          Password
          <input required minLength={12} maxLength={128} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="new-password" />
        </label>
        <label className="mb-4 block text-xs text-muted">
          Confirm password
          <input required minLength={12} maxLength={128} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} autoComplete="new-password" />
        </label>

        <p className="mb-3 text-2xs text-muted">Use 12+ characters with uppercase, lowercase, a number and a symbol.</p>

        {error && <p className="mb-3 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center py-1.5">
          {busy ? 'Joining...' : 'Join workspace'}
        </Button>
      </form>
    </div>
  )
}
