'use client'
import { useState } from 'react'
import { Coupons, Links, Stores, Affiliates } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { CouponRow, LinkRow } from '@/lib/api'

const inputCls = 'rounded-md border border-line bg-white px-2 py-1 text-xs'

export default function MarketingPage() {
  const [tab, setTab] = useState('links')
  return (
    <div>
      <PageHeader
        title="Links & Coupons"
        subtitle="Tracking links and discount codes for your affiliates"
        actions={<FilterTabs value={tab} onChange={setTab} options={[{ value: 'links', label: 'Links' }, { value: 'coupons', label: 'Coupons' }]} />}
      />
      {tab === 'links' ? <LinksPanel /> : <CouponsPanel />}
    </div>
  )
}

function LinksPanel() {
  const { data: stats, reload: reloadStats } = useFetch(() => Links.stats(), [])
  const { data: affiliates } = useFetch(() => Affiliates.list(), [])
  const { data: stores } = useFetch(() => Stores.list(), [])
  const [affiliateId, setAffiliateId] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const { data, loading, error, reload } = useFetch(
    () => Links.list({ affiliateId: affiliateId || undefined, search: query || undefined }),
    [affiliateId, query],
  )

  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [form, setForm] = useState({ affiliateId: '', destinationUrl: '', storeId: '', shortCode: '' })

  function refreshAll() {
    reload()
    reloadStats()
  }

  async function submit() {
    setBusy(true)
    setFormErr(null)
    try {
      await Links.create({
        affiliateId: form.affiliateId,
        destinationUrl: form.destinationUrl,
        storeId: form.storeId || undefined,
        shortCode: form.shortCode || undefined,
      })
      setForm({ affiliateId: '', destinationUrl: '', storeId: '', shortCode: '' })
      setShowForm(false)
      refreshAll()
    } catch (e) {
      setFormErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this link?')) return
    try {
      await Links.remove(id)
      refreshAll()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  function copy(url: string, id: string) {
    navigator.clipboard?.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const columns: Column<LinkRow>[] = [
    { key: 'shortUrl', header: 'Short link', render: (r) => (
      <div className="flex items-center gap-1.5">
        <code className="text-2xs">{r.shortCode}</code>
        <Button variant="ghost" onClick={() => copy(r.shortUrl, r.id)}>{copied === r.id ? 'Copied' : 'Copy'}</Button>
      </div>
    ) },
    { key: 'destinationUrl', header: 'Destination', render: (r) => <span className="text-2xs text-muted">{r.destinationUrl}</span> },
    { key: 'affiliate', header: 'Affiliate', render: (r) => r.affiliate?.affiliateCode ?? '—' },
    { key: 'clicksCount', header: 'Clicks', align: 'right', render: (r) => r.clicksCount.toLocaleString() },
    { key: 'createdAt', header: 'Created', align: 'right', render: (r) => shortDate(r.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (r) => <Button variant="danger" onClick={() => del(r.id)}>Delete</Button> },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatCard label="Links" value={String(stats?.total ?? 0)} />
        <StatCard label="Total clicks" value={(stats?.totalClicks ?? 0).toLocaleString()} />
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={affiliateId} onChange={(e) => setAffiliateId(e.target.value)}>
            <option value="">All affiliates</option>
            {(affiliates?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.affiliateCode}</option>)}
          </select>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(search) }} className="flex items-center gap-1.5">
            <input className={inputCls} placeholder="Search URL / code…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button variant="outline" type="submit">Search</Button>
          </form>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : 'New link'}</Button>
      </div>

      {showForm && (
        <Card title="Create tracking link">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className={inputCls} value={form.affiliateId} onChange={(e) => setForm({ ...form, affiliateId: e.target.value })}>
              <option value="">Affiliate…</option>
              {(affiliates?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.affiliateCode}</option>)}
            </select>
            <input className={inputCls} placeholder="Destination URL" value={form.destinationUrl} onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })} />
            <select className={inputCls} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              <option value="">No store</option>
              {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className={inputCls} placeholder="Custom code (optional)" value={form.shortCode} onChange={(e) => setForm({ ...form, shortCode: e.target.value })} />
          </div>
          {formErr && <p className="text-2xs text-danger mt-2">{formErr}</p>}
          <div className="mt-3">
            <Button onClick={submit} disabled={busy || !form.affiliateId || !form.destinationUrl}>{busy ? 'Creating…' : 'Create link'}</Button>
          </div>
        </Card>
      )}

      {error ? <p className="text-xs text-danger">{error}</p> : (
        <div className="mt-3">
          <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No links yet" />
        </div>
      )}
    </div>
  )
}

function CouponsPanel() {
  const { data: stats, reload: reloadStats } = useFetch(() => Coupons.stats(), [])
  const { data: affiliates } = useFetch(() => Affiliates.list(), [])
  const { data: stores } = useFetch(() => Stores.list(), [])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const { data, loading, error, reload } = useFetch(
    () => Coupons.list({ status: status || undefined, search: query || undefined }),
    [status, query],
  )

  const [mode, setMode] = useState<'single' | 'bulk' | null>(null)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [single, setSingle] = useState({ storeId: '', code: '', affiliateId: '', discountType: '' })
  const [bulk, setBulk] = useState({ storeId: '', count: '10', prefix: '', affiliateId: '', discountType: '' })

  function refreshAll() {
    reload()
    reloadStats()
  }

  async function createSingle() {
    setBusy(true)
    setFormErr(null)
    try {
      await Coupons.create({
        storeId: single.storeId,
        code: single.code,
        affiliateId: single.affiliateId || undefined,
        discountType: (single.discountType || undefined) as 'percentage' | 'fixed' | undefined,
      })
      setSingle({ storeId: '', code: '', affiliateId: '', discountType: '' })
      setMode(null)
      refreshAll()
    } catch (e) {
      setFormErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function generateBulk() {
    setBusy(true)
    setFormErr(null)
    try {
      const res = await Coupons.bulkGenerate({
        storeId: bulk.storeId,
        count: Number(bulk.count || 0),
        prefix: bulk.prefix || undefined,
        affiliateId: bulk.affiliateId || undefined,
        discountType: (bulk.discountType || undefined) as 'percentage' | 'fixed' | undefined,
      })
      setMode(null)
      alert(`Generated ${res.created} coupon codes`)
      refreshAll()
    } catch (e) {
      setFormErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(c: CouponRow) {
    const next = c.status === 'active' ? 'disabled' : 'active'
    try {
      await Coupons.update(c.id, { status: next })
      refreshAll()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  async function remove(c: CouponRow) {
    const orders = c._count?.orders ?? 0
    if (orders > 0) {
      alert('This coupon has attributed orders. Disable it instead so historical reports stay accurate.')
      return
    }
    if (!confirm(`Delete coupon ${c.code}? This cannot be undone.`)) return
    try {
      await Coupons.remove(c.id)
      refreshAll()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const columns: Column<CouponRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <code className="text-2xs font-medium">{r.code}</code> },
    { key: 'store', header: 'Store', render: (r) => r.store?.name ?? '—' },
    { key: 'affiliate', header: 'Affiliate', render: (r) => r.affiliate?.affiliateCode ?? <span className="text-muted">Unassigned</span> },
    { key: 'discountType', header: 'Type', render: (r) => r.discountType ?? '—' },
    { key: 'orders', header: 'Orders', align: 'right', render: (r) => String(r._count?.orders ?? 0) },
    { key: 'expiresAt', header: 'Expires', align: 'right', render: (r) => (r.expiresAt ? shortDate(r.expiresAt) : '—') },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'actions', header: '', align: 'right', render: (r) => (
      <div className="flex justify-end gap-1.5">
        <Button variant="outline" onClick={() => toggle(r)}>{r.status === 'active' ? 'Disable' : 'Enable'}</Button>
        <Button
          variant="danger"
          disabled={(r._count?.orders ?? 0) > 0}
          onClick={() => remove(r)}
          title={(r._count?.orders ?? 0) > 0 ? 'Coupons with orders must be disabled, not deleted' : 'Delete coupon'}
        >
          Delete
        </Button>
      </div>
    ) },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <StatCard label="Coupons" value={String(stats?.total ?? 0)} />
        <StatCard label="Active" value={String(stats?.active ?? 0)} />
        <StatCard label="Disabled" value={String(stats?.disabled ?? 0)} />
        <StatCard label="Assigned" value={String(stats?.assigned ?? 0)} />
        <StatCard label="Unassigned" value={String(stats?.unassigned ?? 0)} />
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="expired">Expired</option>
          </select>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(search) }} className="flex items-center gap-1.5">
            <input className={inputCls} placeholder="Search code…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button variant="outline" type="submit">Search</Button>
          </form>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" onClick={() => setMode(mode === 'single' ? null : 'single')}>New coupon</Button>
          <Button onClick={() => setMode(mode === 'bulk' ? null : 'bulk')}>Bulk generate</Button>
        </div>
      </div>

      {mode === 'single' && (
        <Card title="Create coupon">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className={inputCls} value={single.storeId} onChange={(e) => setSingle({ ...single, storeId: e.target.value })}>
              <option value="">Store…</option>
              {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className={inputCls} placeholder="Code" value={single.code} onChange={(e) => setSingle({ ...single, code: e.target.value })} />
            <select className={inputCls} value={single.affiliateId} onChange={(e) => setSingle({ ...single, affiliateId: e.target.value })}>
              <option value="">Unassigned</option>
              {(affiliates?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.affiliateCode}</option>)}
            </select>
            <select className={inputCls} value={single.discountType} onChange={(e) => setSingle({ ...single, discountType: e.target.value })}>
              <option value="">No type</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          {formErr && <p className="text-2xs text-danger mt-2">{formErr}</p>}
          <div className="mt-3"><Button onClick={createSingle} disabled={busy || !single.storeId || !single.code}>{busy ? 'Saving…' : 'Create'}</Button></div>
        </Card>
      )}

      {mode === 'bulk' && (
        <Card title="Bulk generate coupon codes">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <select className={inputCls} value={bulk.storeId} onChange={(e) => setBulk({ ...bulk, storeId: e.target.value })}>
              <option value="">Store…</option>
              {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className={inputCls} type="number" placeholder="Count" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} />
            <input className={inputCls} placeholder="Prefix (optional)" value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} />
            <select className={inputCls} value={bulk.affiliateId} onChange={(e) => setBulk({ ...bulk, affiliateId: e.target.value })}>
              <option value="">Unassigned</option>
              {(affiliates?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.affiliateCode}</option>)}
            </select>
            <select className={inputCls} value={bulk.discountType} onChange={(e) => setBulk({ ...bulk, discountType: e.target.value })}>
              <option value="">No type</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          {formErr && <p className="text-2xs text-danger mt-2">{formErr}</p>}
          <div className="mt-3"><Button onClick={generateBulk} disabled={busy || !bulk.storeId || !bulk.count}>{busy ? 'Generating…' : 'Generate'}</Button></div>
        </Card>
      )}

      {error ? <p className="text-xs text-danger">{error}</p> : (
        <div className="mt-3">
          <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No coupons yet" />
        </div>
      )}
    </div>
  )
}
