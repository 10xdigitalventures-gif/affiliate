'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { Camera, CheckCircle2, ImageOff, Mail, Phone, UserRound } from 'lucide-react'
import { Auth, AuthUser } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

function initials(name?: string | null, email?: string) {
  const source = name?.trim() || email?.split('@')[0] || 'Account'
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase()
}

function readAndCompressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Please choose a JPG, PNG or WebP image.'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Profile picture must be smaller than 5 MB.'))
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
        const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2)
        const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2)
        let dataUrl = ''

        for (const [size, quality] of [[256, 0.78], [224, 0.65], [192, 0.58]] as const) {
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Your browser could not process this image.')
          context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)
          dataUrl = canvas.toDataURL('image/jpeg', quality)
          if (dataUrl.length <= 85_000) break
        }

        if (!dataUrl || dataUrl.length > 90_000) {
          throw new Error('This image could not be compressed. Please choose another one.')
        }
        resolve(dataUrl)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('The selected image could not be opened.'))
    }
    image.src = objectUrl
  })
}

export function ProfileSettings() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [processingImage, setProcessingImage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Auth.me()
      .then((account) => {
        setUser(account)
        setFullName(account.fullName || '')
        setEmail(account.email)
        setPhoneNumber(account.phoneNumber || '')
        setAvatarUrl(account.avatarUrl || null)
      })
      .catch((err) => setError((err as Error).message || 'Profile could not be loaded.'))
      .finally(() => setLoading(false))
  }, [])

  async function choosePicture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProcessingImage(true)
    setSaved(false)
    setError(null)
    try {
      setAvatarUrl(await readAndCompressImage(file))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProcessingImage(false)
    }
  }

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
        phoneNumber: phoneNumber.trim() || null,
        avatarUrl,
      })
      setUser(updated)
      setFullName(updated.fullName || '')
      setEmail(updated.email)
      setPhoneNumber(updated.phoneNumber || '')
      setAvatarUrl(updated.avatarUrl || null)
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
      <PageHeader title="Profile settings" subtitle="Update your personal information and profile picture" />
      <form onSubmit={save} className="space-y-3">
        <Card>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative h-24 w-24 shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile preview" className="h-24 w-24 rounded-full border border-line object-cover" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full bg-brand/10 text-xl font-semibold text-brand">
                  {initials(fullName, email)}
                </div>
              )}
              <label
                className="absolute bottom-0 right-0 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-white bg-brand text-white shadow-card transition hover:bg-brand-600"
                title="Choose profile picture"
              >
                <Camera size={15} />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={choosePicture}
                  disabled={processingImage || saving}
                  className="sr-only"
                />
              </label>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Profile picture</h2>
              <p className="mt-1 text-xs text-muted">JPG, PNG or WebP. Maximum source size 5 MB.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600">
                  <Camera size={14} />
                  {processingImage ? 'Processing…' : avatarUrl ? 'Change picture' : 'Upload picture'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={choosePicture}
                    disabled={processingImage || saving}
                    className="sr-only"
                  />
                </label>
                {avatarUrl && (
                  <Button type="button" variant="outline" onClick={() => { setAvatarUrl(null); setSaved(false) }}>
                    <ImageOff size={14} /> Remove
                  </Button>
                )}
              </div>
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
                onChange={(event) => { setFullName(event.target.value); setSaved(false) }}
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
                onChange={(event) => { setEmail(event.target.value); setSaved(false) }}
                className={inputClass}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink">
                <Phone size={14} className="text-muted" /> Phone number
              </span>
              <input
                type="tel"
                maxLength={32}
                value={phoneNumber}
                onChange={(event) => { setPhoneNumber(event.target.value); setSaved(false) }}
                className={inputClass}
                autoComplete="tel"
                placeholder="+92 300 1234567"
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
                  onChange={(event) => setCurrentPassword(event.target.value)}
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
          <Button type="submit" disabled={saving || processingImage || !user} className="px-4 py-1.5">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
