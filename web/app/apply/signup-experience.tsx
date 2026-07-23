'use client'
import { useEffect, useRef, useState } from 'react'

type Status = 'loading' | 'open' | 'closed' | 'submitted' | 'approved' | 'error'

type Branding = {
  headline: string | null
  subheadline: string | null
  imageUrl: string | null
  accentColor: string
  layout: 'split' | 'centered'
  buttonText: string
}

const DEFAULT_BRANDING: Branding = {
  headline: null,
  subheadline: null,
  imageUrl: null,
  accentColor: '#1B4DFF',
  layout: 'split',
  buttonText: 'Apply now',
}

export function SignupExperience({ slug, variant }: { slug: string; variant: 'page' | 'embed' }) {
  const [status, setStatus] = useState<Status>('loading')
  const [orgName, setOrgName] = useState('')
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', website: '', message: '' })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/v1/signup/${slug}/status`)
      .then((r) => r.json())
      .then((d) => {
        setOrgName(d.orgName ?? slug)
        // The embed can use its own design when the tenant enabled a custom embed
        // branding; otherwise it inherits the hosted-page branding.
        const chosen =
          variant === 'embed' && d.embedBranding && d.embedBranding.custom
            ? d.embedBranding
            : d.branding
        setBranding({ ...DEFAULT_BRANDING, ...(chosen ?? {}) })
        setStatus(d.open ? 'open' : 'closed')
      })
      .catch(() => setStatus('error'))
  }, [slug, variant])

  // When embedded in an iframe, report our height to the parent page so it can
  // auto-resize the frame (see the auto-resize snippet in the dashboard).
  useEffect(() => {
    if (variant !== 'embed') return
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      window.parent?.postMessage({ type: 'affiliate-embed', event: 'resize', height, slug }, '*')
    }
    const ro = new ResizeObserver(post)
    ro.observe(el)
    post()
    return () => ro.disconnect()
  }, [variant, status, err, slug])

  const accent = branding.accentColor || '#1B4DFF'
  const accentStyle = { backgroundColor: accent }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/v1/signup/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Submission failed')
      setStatus(data.autoApproved ? 'approved' : 'submitted')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof typeof form, label: string, type = 'text', required = false) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        required={required}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
      />
    </div>
  )

  const Centered = ({ children }: { children: React.ReactNode }) => (
    <div className={variant === 'embed' ? 'w-full' : 'min-h-screen flex items-center justify-center bg-gray-50 py-10 px-4'}>
      {children}
    </div>
  )

  if (status === 'loading') {
    return (
      <Centered>
        <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      </Centered>
    )
  }

  if (status === 'error' || status === 'closed') {
    return (
      <Centered>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-md w-full text-center">
          <div className="text-3xl mb-3">{status === 'closed' ? '\uD83D\uDD12' : '\u26A0\uFE0F'}</div>
          <h1 className="font-semibold text-gray-900 mb-1">
            {status === 'closed' ? 'Signup is currently closed' : 'Program not found'}
          </h1>
          <p className="text-sm text-gray-500">
            {status === 'closed'
              ? `${orgName} is not accepting new affiliate applications right now.`
              : 'This affiliate program link may be incorrect.'}
          </p>
        </div>
      </Centered>
    )
  }

  if (status === 'submitted' || status === 'approved') {
    const approved = status === 'approved'
    return (
      <Centered>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-3">{approved ? '\u2705' : '\uD83C\uDF89'}</div>
          <h1 className="font-semibold text-gray-900 mb-1">{approved ? "You're approved!" : 'Application submitted!'}</h1>
          <p className="text-sm text-gray-500">
            {approved ? (
              <>Welcome to <strong>{orgName}</strong>'s affiliate program. Check your email for your affiliate link and dashboard access.</>
            ) : (
              <>Thanks for applying to <strong>{orgName}</strong>'s affiliate program. We'll review your application and get back to you soon.</>
            )}
          </p>
        </div>
      </Centered>
    )
  }

  const formCard = (
    <div className={`bg-white ${variant === 'embed' ? '' : 'rounded-2xl border border-gray-100 shadow-sm'} p-8 w-full`}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">{branding.headline || `${orgName} Affiliate Program`}</h1>
        <p className="text-sm text-gray-500 mt-1">{branding.subheadline || 'Fill in your details to apply and start earning commissions.'}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {field('firstName', 'First name', 'text', true)}
          {field('lastName', 'Last name', 'text', true)}
        </div>
        {field('email', 'Email address', 'email', true)}
        {field('website', 'Website / Social', 'url')}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-0.5">Why do you want to join?</label>
          <textarea
            rows={3}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 resize-none"
          />
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          style={accentStyle}
          className="mt-1 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
        >
          {busy ? 'Submitting...' : (branding.buttonText || 'Apply now')}
        </button>
      </form>
    </div>
  )

  if (variant === 'embed') {
    return <div ref={rootRef} className="w-full max-w-lg mx-auto">{formCard}</div>
  }

  if (branding.layout === 'split' && branding.imageUrl) {
    return (
      <div className="min-h-screen grid md:grid-cols-2 bg-gray-50">
        <div className="hidden md:block relative" style={accentStyle}>
          <img src={branding.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
        <div className="flex items-center justify-center py-10 px-4">
          <div className="w-full max-w-lg">{formCard}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-10 px-4">
      <div className="w-full max-w-lg">{formCard}</div>
    </div>
  )
}
