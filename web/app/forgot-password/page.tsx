'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { Auth } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await Auth.forgotPassword(email.trim(), workspace.trim().toLowerCase() || undefined)
      setSent(true)
    } catch (err) {
      setError((err as Error).message || 'The reset request could not be sent.')
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
        <h1 className="text-base font-semibold">Reset your password</h1>
        <p className="mb-4 text-xs text-muted">Enter your account email. If it matches one account, we will email a one-time reset link.</p>

        {sent ? (
          <div className="rounded-md border border-success/20 bg-success/5 p-3 text-xs text-success">
            Check your inbox and spam folder. For privacy, this message is the same whether or not an account exists.
          </div>
        ) : (
          <>
            <label className="block text-xs text-muted">
              Email address
              <input
                required
                autoFocus
                type="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="mt-3 block text-xs text-muted">
              Workspace slug (only if this email belongs to multiple teams)
              <input
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                maxLength={50}
                autoComplete="organization"
                className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            {error && <p className="mt-3 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-4 w-full justify-center py-1.5">
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
          </>
        )}

        <Link href="/login" className="mt-4 block text-center text-2xs text-brand hover:underline">Back to sign in</Link>
      </form>
    </div>
  )
}
