'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { CheckCircle2, Mail, UserRound } from 'lucide-react'
import { Auth, AuthUser } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

function initials(name?: string | null, email?: string) {
  const source = name?.trim() || email?.split('@')[0] || 'Account'
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase()
}

export function ProfileSettings() {
  const [user, setUser] = useState<(AuthUser & { status: string; emailVerifiedAt: string | null; twoFactorEnabled: boolean; isSuperAdmin: boolean }) | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Auth.me()
      .then((account) => {
        setUser(account)
        setFullName(account.fullName || '')
        setEmail(account.email)
      })
      .catch((err) => setError((err as Error).message || 'Profile could not be loaded.'))
      .finally(() => setLoading(false))
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await Auth.updateProfile({
        fullName: fullName.trim(),
        email: email.trim(),
        ...(email.trim().toLowerCase() !== user?.email.toLowerCase() ? { currentPassword } : {}),
      })
      setUser(updated)
      setFullName(updated.fullName || '')
      setEmail(updated.email)
      setCurrentPassword('')
      window.localStorage.setItem('user', JSON.stringify(updated))
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: updated }))
      setSaved(true)
    } catch (err) {
      setError((err as Error).message || 'Profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand'

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted">Loading profile…</div>
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profile settings" subtitle="Update your personal information" />
      <form onSubmit={save} className="space-y-3">
        <Card>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-brand/10 text-xl font-semibold text-brand">
              {initials(fullName, email)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{fullName || email}</h2>
              <p className="mt-1 text-xs text-muted">{email}</p>
            </div>
          </div>
        </Card>

        <Card title="Personal information">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink">
                <UserRound size={14} className="text-muted" /> Full name
              </span>
              <input
                required
                maxLength={80}
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setSaved(false) }}
                className={inputClass}
                autoComplete="name"
                placeholder="Your full name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink">
                <Mail size={14} className="text-muted" /> Email address
              </span>
              <input
                required
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSaved(false) }}
                className={inputClass}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            {email.trim().toLowerCase() !== user?.email.toLowerCase() && (
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-ink">Current password</span>
                <input
                  required
                  type="password"
                  maxLength={128}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                  autoComplete="current-password"
                  placeholder="Confirm your password to change email"
                />
              </label>
            )}
          </div>
          <p className="mt-3 text-2xs text-muted">Changing your email also changes the email you use for your next login.</p>
        </Card>

        {error && <div className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}
        {saved && (
          <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
            <CheckCircle2 size={15} /> Profile updated successfully.
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !user} className="px-4 py-1.5">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
