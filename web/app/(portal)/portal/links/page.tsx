'use client'
import { useState } from 'react'
import { Portal } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Check, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { PortalLink } from '@/lib/api'

export default function PortalLinks() {
  const links = useFetch(() => Portal.links(), [])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [destinationUrl, setDestinationUrl] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [utmContent, setUtmContent] = useState('')
  const [utmTerm, setUtmTerm] = useState('')

  async function copy(value: string, id: string) {
    await navigator.clipboard.writeText(value)
    setCopied(id)
    window.setTimeout(() => setCopied(null), 1800)
  }

  async function createLink() {
    setBusy(true)
    setActionError(null)
    try {
      const link = await Portal.createLink({
        destinationUrl: destinationUrl.trim(),
        shortCode: shortCode.trim() || undefined,
        utmSource: utmSource.trim() || undefined,
        utmMedium: utmMedium.trim() || undefined,
        utmCampaign: utmCampaign.trim() || undefined,
        utmContent: utmContent.trim() || undefined,
        utmTerm: utmTerm.trim() || undefined,
      })
      setDestinationUrl('')
      setShortCode('')
      setUtmSource('')
      setUtmMedium('')
      setUtmCampaign('')
      setUtmContent('')
      setUtmTerm('')
      setShowForm(false)
      await links.refresh()
      await copy(link.shortUrl, link.id)
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteLink(link: PortalLink) {
    if (link.clicksCount > 0 || !window.confirm('Delete this unused tracking link?')) return
    setActionError(null)
    try {
      await Portal.deleteLink(link.id)
      await links.refresh()
    } catch (error) {
      setActionError((error as Error).message)
    }
  }

  const columns: Column<PortalLink>[] = [
    {
      key: 'shortCode',
      header: 'Tracking link',
      render: (r) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <a href={r.shortUrl} target="_blank" rel="noreferrer" className="max-w-72 truncate font-mono text-xs text-brand hover:underline">
            {r.shortUrl}
          </a>
          <button type="button" onClick={() => copy(r.shortUrl, r.id)} className="rounded p-1 text-muted hover:bg-gray-100" title="Copy link">
            {copied === r.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
          <a href={r.shortUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-muted hover:bg-gray-100" title="Open link">
            <ExternalLink size={14} />
          </a>
        </div>
      ),
    },
    { key: 'destinationUrl', header: 'Destination', render: (r) => <span className="text-muted">{r.destinationUrl}</span> },
    { key: 'clicksCount', header: 'Clicks', align: 'right', render: (r) => r.clicksCount },
    { key: 'createdAt', header: 'Created', render: (r) => shortDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          disabled={r.clicksCount > 0}
          onClick={() => deleteLink(r)}
          className="rounded p-1 text-muted hover:bg-danger/5 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
          title={r.clicksCount > 0 ? 'Links with clicks are retained for reporting' : 'Delete unused link'}
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="My links" subtitle="Share these to earn commissions" />
      <div className="mb-3 flex justify-end">
        <Button onClick={() => { setShowForm((value) => !value); setActionError(null) }}>
          <Plus size={14} /> {showForm ? 'Close' : 'Create link'}
        </Button>
      </div>

      {showForm && (
        <Card title="Create a tracking link" className="mb-3">
          <p className="mb-3 text-xs text-muted">Use an HTTPS page from a connected store. UTM fields are optional and will be added safely to the destination.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs font-medium">
              Destination URL
              <input type="url" required value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://store.example.com/products/product" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              Custom short code (optional)
              <input value={shortCode} onChange={(event) => setShortCode(event.target.value)} placeholder="abaan-offer" maxLength={20} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              UTM campaign
              <input value={utmCampaign} onChange={(event) => setUtmCampaign(event.target.value)} placeholder="summer-sale" maxLength={150} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              UTM source
              <input value={utmSource} onChange={(event) => setUtmSource(event.target.value)} placeholder="instagram" maxLength={100} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              UTM medium
              <input value={utmMedium} onChange={(event) => setUtmMedium(event.target.value)} placeholder="affiliate" maxLength={100} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              UTM content
              <input value={utmContent} onChange={(event) => setUtmContent(event.target.value)} placeholder="video-1" maxLength={150} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              UTM term
              <input value={utmTerm} onChange={(event) => setUtmTerm(event.target.value)} placeholder="optional" maxLength={150} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
            </label>
          </div>
          {actionError && <p className="mt-3 text-xs text-danger">{actionError}</p>}
          <div className="mt-3 flex justify-end">
            <Button onClick={createLink} disabled={busy || !destinationUrl.trim()}>{busy ? 'Creating…' : 'Create and copy link'}</Button>
          </div>
        </Card>
      )}

      {!showForm && actionError && <p className="mb-2 text-xs text-danger">{actionError}</p>}
      {links.error && <p className="text-xs text-danger mb-2">{links.error}</p>}
      <DataTable columns={columns} rows={links.data ?? []} loading={links.loading} empty="No links yet — create your first tracking link" />
    </div>
  )
}
