'use client'
import { useState } from 'react'
import { Catalog, Stores } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ProductRow } from '@/lib/api'

const inputCls = 'rounded-md border border-line bg-white px-2 py-1 text-xs'

export default function CatalogPage() {
  const [storeId, setStoreId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const { data: stats, reload: reloadStats } = useFetch(() => Catalog.stats(), [])
  const { data: stores } = useFetch(() => Stores.list(), [])
  const { data: categories, reload: reloadCats } = useFetch(() => Catalog.categories(), [])
  const { data, loading, error, reload } = useFetch(
    () => Catalog.products({ storeId: storeId || undefined, categoryId: categoryId || undefined, status: status || undefined, search: query || undefined, take: 50 }),
    [storeId, categoryId, status, query],
  )

  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [form, setForm] = useState({ storeId: '', externalId: '', name: '', price: '', sku: '', categoryName: '', status: 'active' as 'active' | 'inactive' })

  function refreshAll() {
    reload()
    reloadStats()
    reloadCats()
  }

  async function submit() {
    setBusy(true)
    setFormErr(null)
    try {
      await Catalog.upsert({
        storeId: form.storeId,
        externalId: form.externalId,
        name: form.name,
        price: Number(form.price || 0),
        sku: form.sku || undefined,
        categoryName: form.categoryName || undefined,
        status: form.status,
      })
      setShowForm(false)
      setForm({ storeId: '', externalId: '', name: '', price: '', sku: '', categoryName: '', status: 'active' })
      refreshAll()
    } catch (e) {
      setFormErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<ProductRow>[] = [
    { key: 'name', header: 'Product', render: (r) => (
      <div>
        <div className="font-medium">{r.name}</div>
        <div className="text-2xs text-muted">{r.sku ? `SKU ${r.sku} · ` : ''}#{r.externalId}</div>
      </div>
    ) },
    { key: 'store', header: 'Store', render: (r) => r.store?.name ?? '—' },
    { key: 'category', header: 'Category', render: (r) => r.category?.name ?? '—' },
    { key: 'price', header: 'Price', align: 'right', render: (r) => money(r.price) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'createdAt', header: 'Added', align: 'right', render: (r) => shortDate(r.createdAt) },
  ]

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle="Products and categories synced from your connected stores"
        actions={<Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : 'Add product'}</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <StatCard label="Products" value={String(stats?.total ?? 0)} />
        <StatCard label="Active" value={String(stats?.active ?? 0)} />
        <StatCard label="Inactive" value={String(stats?.inactive ?? 0)} />
        <StatCard label="Categories" value={String(stats?.categories ?? 0)} />
        <StatCard label="Stores" value={String(stats?.stores ?? 0)} />
      </div>

      {showForm && (
        <Card title="Add / update product">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <select className={inputCls} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              <option value="">Select store…</option>
              {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className={inputCls} placeholder="External ID" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            <input className={inputCls} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} placeholder="Price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <input className={inputCls} placeholder="SKU (optional)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <input className={inputCls} placeholder="Category (optional)" value={form.categoryName} onChange={(e) => setForm({ ...form, categoryName: e.target.value })} />
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {formErr && <p className="text-2xs text-danger mt-2">{formErr}</p>}
          <div className="mt-3">
            <Button onClick={submit} disabled={busy || !form.storeId || !form.externalId || !form.name}>{busy ? 'Saving…' : 'Save product'}</Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 my-3">
        <select className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All stores</option>
          {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(search) }} className="flex items-center gap-1.5">
          <input className={inputCls} placeholder="Search name / SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="outline" type="submit">Search</Button>
        </form>
      </div>

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        <>
          <DataTable columns={columns} rows={data?.items ?? []} loading={loading} empty="No products yet — sync a store or add one manually" />
          {data && <p className="text-2xs text-muted mt-1.5">{data.items.length} of {data.total} products</p>}
        </>
      )}
    </div>
  )
}
