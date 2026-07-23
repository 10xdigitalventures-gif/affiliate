'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { Auth } from '@/lib/api'
import { Button } from '@/components/ui/button'

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/

export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '')
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!token) return setError('This reset link is missing its token.')
    if (!strongPassword.test(password)) return setError('Use 12+ characters with uppercase, lowercase, a number and a symbol.')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await Auth.resetPassword(token, password)
      setComplete(true)
    } catch (err) {
      setError((err as Error).message || 'This reset link could not be used.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-5 w-5 rounded-md bg-brand" aria-hidden />
          <span className="text-sm font-semibold">Affiliate</span>
        </div>
        <h1 className="text-base font-semibold">Choose a new password</h1>
        <p className="mb-4 text-xs text-muted">The link works once and expires automatically.</p>

        {complete ? (
          <div className="rounded-md border border-success/20 bg-success/5 p-3 text-xs text-success">
            Password updated. All previous sessions have been signed out.
          </div>
        ) : (
          <>
            <label className="mb-3 block text-xs text-muted">
              New password
              <input required autoFocus minLength={12} maxLength={128} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" autoComplete="new-password" />
            </label>
            <label className="block text-xs text-muted">
              Confirm new password
              <input required minLength={12} maxLength={128} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" autoComplete="new-password" />
            </label>
            <p className="mt-2 text-2xs text-muted">12+ characters, uppercase, lowercase, number and symbol.</p>
            {error && <p className="mt-3 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-4 w-full justify-center py-1.5">
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </>
        )}

        <Link href="/login" className="mt-4 block text-center text-2xs text-brand hover:underline">Back to sign in</Link>
      </form>
    </div>
  )
}
