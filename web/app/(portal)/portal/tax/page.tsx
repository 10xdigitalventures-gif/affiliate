'use client'
import { useState, useEffect } from 'react'
import { Portal } from '@/lib/api'
import type { TaxStatus } from '@/lib/api'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'

const W9_CLASSES = [
  { value: 'individual', label: 'Individual / sole proprietor' },
  { value: 'c_corp', label: 'C corporation' },
  { value: 's_corp', label: 'S corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'trust', label: 'Trust / estate' },
  { value: 'llc', label: 'Limited liability company' },
]

export default function PortalTax() {
  const [status, setStatus] = useState<TaxStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [formType, setFormType] = useState<'w9' | 'w8ben'>('w9')
  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [taxClassification, setTaxClassification] = useState('individual')
  const [tinType, setTinType] = useState<'ssn' | 'ein'>('ssn')
  const [tin, setTin] = useState('')
  const [country, setCountry] = useState('United States')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [signature, setSignature] = useState('')
  const [certify, setCertify] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const s = await Portal.tax()
      setStatus(s)
      setEditing(s.status === 'not_submitted' || s.status === 'rejected')
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function submit() {
    setBusy(true); setError(null); setSaved(false)
    try {
      await Portal.submitTax({
        formType,
        legalName,
        businessName: businessName || undefined,
        taxClassification: formType === 'w9' ? taxClassification : undefined,
        tinType: formType === 'w9' ? tinType : undefined,
        tin,
        country,
        address1,
        address2: address2 || undefined,
        city,
        state: region || undefined,
        postalCode: postalCode || undefined,
        signature,
        certify,
      })
      setSaved(true)
      setTin('')
      await load()
      setEditing(false)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const input = 'mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm'

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Tax information" subtitle="Provide your W-9 (US) or W-8BEN (non-US) details so we can pay you and file year-end forms" />
      {loading ? <p className="text-xs text-muted">Loading...</p> : (
        <>
          <Card title="Status" className="mb-3">
            <div className="flex items-center justify-between">
              <div>
                <StatusPill status={status?.status ?? 'not_submitted'} />
                {status?.tinLast4 && <span className="ml-2 text-xs text-muted">TIN ending in {status.tinLast4}</span>}
                {status?.certifiedAt && <p className="text-2xs text-muted mt-1">Submitted {new Date(status.certifiedAt).toLocaleDateString()}</p>}
                {status?.reviewNote && <p className="text-2xs text-danger mt-1">Note: {status.reviewNote}</p>}
              </div>
              {!editing && <Button variant="outline" onClick={() => setEditing(true)}>Update form</Button>}
            </div>
            {status?.required && status?.status === 'not_submitted' && (
              <p className="text-xs text-danger mt-2">A completed tax form is required before you can request a payout.</p>
            )}
          </Card>

          {editing && (
            <Card title="Tax form">
              <div className="space-y-3">
                <div>
                  <label className="text-2xs text-muted">Form type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value as 'w9' | 'w8ben')} className={input}>
                    <option value="w9">W-9 (US person)</option>
                    <option value="w8ben">W-8BEN (non-US person)</option>
                  </select>
                </div>
                <div>
                  <label className="text-2xs text-muted">Legal name</label>
                  <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={input} />
                </div>
                <div>
                  <label className="text-2xs text-muted">Business name (optional)</label>
                  <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={input} />
                </div>
                {formType === 'w9' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-2xs text-muted">Federal tax classification</label>
                      <select value={taxClassification} onChange={(e) => setTaxClassification(e.target.value)} className={input}>
                        {W9_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-2xs text-muted">TIN type</label>
                      <select value={tinType} onChange={(e) => setTinType(e.target.value as 'ssn' | 'ein')} className={input}>
                        <option value="ssn">SSN</option>
                        <option value="ein">EIN</option>
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-2xs text-muted">{formType === 'w9' ? 'Taxpayer ID (SSN or EIN)' : 'Foreign tax ID'}</label>
                  <input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="Encrypted at rest" className={input} />
                </div>
                <div>
                  <label className="text-2xs text-muted">Country</label>
                  <input value={country} onChange={(e) => setCountry(e.target.value)} className={input} />
                </div>
                <div>
                  <label className="text-2xs text-muted">Address line 1</label>
                  <input value={address1} onChange={(e) => setAddress1(e.target.value)} className={input} />
                </div>
                <div>
                  <label className="text-2xs text-muted">Address line 2 (optional)</label>
                  <input value={address2} onChange={(e) => setAddress2(e.target.value)} className={input} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-2xs text-muted">City</label>
                    <input value={city} onChange={(e) => setCity(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className="text-2xs text-muted">State / region</label>
                    <input value={region} onChange={(e) => setRegion(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className="text-2xs text-muted">Postal code</label>
                    <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={input} />
                  </div>
                </div>
                <div>
                  <label className="text-2xs text-muted">Signature (type your full legal name)</label>
                  <input value={signature} onChange={(e) => setSignature(e.target.value)} className={input} />
                </div>
                <label className="flex items-start gap-2 text-xs text-muted">
                  <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5" />
                  <span>Under penalties of perjury, I certify that the information provided is true, correct, and complete.</span>
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <Button disabled={busy || !certify} onClick={submit}>{busy ? 'Submitting...' : 'Submit tax form'}</Button>
                  {status?.status !== 'not_submitted' && <button type="button" onClick={() => setEditing(false)} className="text-2xs text-muted hover:text-brand">Cancel</button>}
                  {saved && <span className="text-xs text-success">Saved!</span>}
                </div>
                {error && <p className="text-xs text-danger">{error}</p>}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
