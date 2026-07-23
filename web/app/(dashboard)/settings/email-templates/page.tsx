'use client'
import { useState, useEffect } from 'react'
import { EmailTemplates } from '@/lib/api'
import type { EmailTemplate } from '@/lib/api'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type Draft = { subject: string; heading: string; body: string }

export default function EmailTemplatesPage() {
  const [items, setItems] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ subject: '', heading: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await EmailTemplates.list()
      setItems(data)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  function edit(t: EmailTemplate) {
    setOpenKey(t.key)
    setDraft({ subject: t.subject, heading: t.heading, body: t.body })
    setPreview(null)
    setSaved(null)
  }

  async function save(key: string) {
    setBusy(true)
    try {
      const data = await EmailTemplates.update(key, draft)
      setItems(data)
      setSaved(key)
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  async function resetOne(key: string) {
    setBusy(true)
    try {
      const data = await EmailTemplates.reset(key)
      setItems(data)
      const t = data.find((x) => x.key === key)
      if (t) setDraft({ subject: t.subject, heading: t.heading, body: t.body })
      setSaved(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to reset')
    } finally {
      setBusy(false)
    }
  }

  async function showPreview(key: string) {
    setBusy(true)
    try {
      const pv = await EmailTemplates.preview(key)
      setPreview(pv)
    } catch (e: any) {
      setError(e?.message || 'Failed to preview')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Email templates" subtitle="Customize the wording of automated emails. Your brand colour and logo are applied automatically." />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <Card title="How this works" className="mb-3">
        <p className="text-xs text-muted">
          Every email uses this workspace brand: the header colour, logo and button colour come from your Branding settings, so each tenant sees their own branding on invites and notifications. You can also rewrite the subject, heading and body text below. Tokens in braces are replaced automatically with real values.
        </p>
      </Card>
      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <Card key={t.key} title={t.label}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted">{t.description}</p>
                  <p className="text-2xs text-muted mt-1">
                    Subject: <span className="text-ink">{t.subject}</span>
                  </p>
                  {t.isCustomized && <span className="text-2xs text-success">Customized</span>}
                </div>
                <Button variant="outline" onClick={() => (openKey === t.key ? setOpenKey(null) : edit(t))}>
                  {openKey === t.key ? 'Close' : 'Edit'}
                </Button>
              </div>
              {openKey === t.key && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <p className="text-2xs text-muted">Available tokens: {t.variables.map((v) => '{' + v + '}').join(', ')}</p>
                  <label className="block">
                    <span className="text-2xs uppercase tracking-wide text-muted">Subject</span>
                    <input className="w-full mt-1 rounded-md border border-line px-2 py-1 text-sm" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-2xs uppercase tracking-wide text-muted">Heading</span>
                    <input className="w-full mt-1 rounded-md border border-line px-2 py-1 text-sm" value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-2xs uppercase tracking-wide text-muted">Body (one paragraph per line)</span>
                    <textarea rows={5} className="w-full mt-1 rounded-md border border-line px-2 py-1 text-sm font-mono" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                  </label>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => save(t.key)} disabled={busy}>Save</Button>
                    <Button variant="outline" onClick={() => showPreview(t.key)} disabled={busy}>Preview</Button>
                    <Button variant="ghost" onClick={() => resetOne(t.key)} disabled={busy}>Reset to default</Button>
                    {saved === t.key && <span className="text-2xs text-success">Saved</span>}
                  </div>
                  {preview && (
                    <div className="mt-2 border border-line rounded-md overflow-hidden">
                      <p className="text-2xs text-muted px-2 py-1 bg-gray-50 border-b border-line">Preview - subject: {preview.subject}</p>
                      <iframe title="preview" className="w-full h-96 border-0" srcDoc={preview.html} />
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
