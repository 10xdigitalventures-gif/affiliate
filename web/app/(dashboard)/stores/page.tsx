'use client'
import { useState } from 'react'
import { Stores } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { StoreRow } from '@/lib/api'

type Platform = 'shopify' | 'woocommerce' | 'ghl'

const PLATFORM_LABELS: Record<Platform, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  ghl: 'GoHighLevel',
}

const PLATFORM_HINTS: Record<Platform, string[]> = {
  shopify: ['Access Token', 'Webhook Secret'],
  woocommerce: ['Consumer Key', 'Consumer Secret', 'Webhook Secret'],
  ghl: ['Access Token (API Key)', 'Webhook Secret'],
}

export default function StoresPage() {
  const { data, loading, error, refresh } = useFetch(() => Stores.list(), [])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    platform: 'shopify' as Platform,
    name: '',
    domain: '',
    accessToken: '',
    consumerKey: '',
    consumerSecret: '',
    webhookSecret: '',
  })

  async function connect() {
    setBusy(true)
    setFormErr(null)
    try {
      await Stores.connect({
        platform: form.platform,
        name: form.name,
        domain: form.domain,
        accessToken: form.accessToken || undefined,
        consumerKey: form.consumerKey || undefined,
        consumerSecret: form.consumerSecret || undefined,
        webhookSecret: form.webhookSecret || undefined,
      })
      setShowForm(false)
      refresh()
    } catch (e) {
      setFormErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<StoreRow>[] = [
    { key: 'name', header: 'Store', render: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: 'platform',
      header: 'Platform',
      render: (r) => (
        <span className="capitalize">
          {PLATFORM_LABELS[r.platform as Platform] ?? r.platform}
        </span>
      ),
    },
    { key: 'domain', header: 'Domain', render: (r) => <span className="text-muted">{r.domain}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'webhookStatus', header: 'Webhooks', render: (r) => <StatusPill status={r.webhookStatus} /> },
    { key: 'lastSyncedAt', header: 'Last sync', render: (r) => shortDate(r.lastSyncedAt) },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Stores"
        subtitle="Connected Shopify, WooCommerce & GoHighLevel stores"
        actions={<Button onClick={() => setShowForm(!showForm)}>Connect store</Button>}
      />

      {showForm && (
        <Card title="Connect a new store" className="mb-3">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="col-span-2">
              <label className="text-2xs text-muted">Platform</label>
              <div className="flex gap-1.5 mt-0.5">
                {(['shopify', 'woocommerce', 'ghl'] as Platform[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setForm({ ...form, platform: p })}
                    className={`rounded-md border px-2.5 py-1 text-xs transition ${
                      form.platform === p
                        ? 'border-brand bg-surface text-brand font-medium'
                        : 'border-line text-muted hover:bg-gray-50'
                    }`}
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-2xs text-muted">Store name</label>
              <input
                className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                placeholder="My store"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-2xs text-muted">Domain</label>
              <input
                className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                placeholder={form.platform === 'ghl' ? 'your-location-id.gohighlevel.com' : 'store.myshopify.com'}
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
              />
            </div>
            {(form.platform === 'shopify' || form.platform === 'ghl') && (
              <div>
                <label className="text-2xs text-muted">
                  {form.platform === 'ghl' ? 'API Key / Access Token' : 'Access Token'}
                </label>
                <input
                  type="password"
                  className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                  value={form.accessToken}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                />
              </div>
            )}
            {form.platform === 'woocommerce' && (
              <>
                <div>
                  <label className="text-2xs text-muted">Consumer Key</label>
                  <input
                    type="password"
                    className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                    value={form.consumerKey}
                    onChange={(e) => setForm({ ...form, consumerKey: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-2xs text-muted">Consumer Secret</label>
                  <input
                    type="password"
                    className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                    value={form.consumerSecret}
                    onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })}
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-2xs text-muted">Webhook Secret</label>
              <input
                type="password"
                className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                value={form.webhookSecret}
                onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
              />
            </div>
          </div>
          {form.platform === 'ghl' && (
            <div className="mb-2 rounded-md bg-surface px-3 py-2 text-xs text-muted">
              <strong className="text-ink">GHL Webhook URL:</strong>
              {` POST https://your-api.com/v1/webhooks/ghl/{storeId}`}
              <br />
              Register in GHL Settings → Webhooks. Select events: OrderCreate, InvoicePaid, SubscriptionCreate, OrderRefund.
            </div>
          )}
          {formErr && <p className="text-xs text-danger mb-2">{formErr}</p>}
          <div className="flex gap-2">
            <Button disabled={busy || !form.name || !form.domain} onClick={connect}>
              {busy ? 'Connecting...' : 'Connect'}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No stores connected" />
    </div>
  )
}
