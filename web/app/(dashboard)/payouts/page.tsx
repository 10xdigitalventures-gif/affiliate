'use client'
import { useState, useCallback } from 'react'
import { Payouts, Affiliates } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import type { PayoutRow } from '@/lib/api'

const METHODS = ['bank', 'wise', 'paypal', 'stripe', 'manual', 'crypto']

export default function PayoutsPage() {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ affiliateId: '', method: 'bank', currency: 'USD' })

  const { data, loading, refresh } = useFetch(() => Payouts.list(status || undefined), [status])
  const affiliates = useFetch(() => Affiliates.list(), [])

  async function act(fn: () => Promise<unknown>) {
    setBusy('busy')
    setError(null)
    try {
      await fn()
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function createBatch() {
    if (!form.affiliateId) return
    await act(() => Payouts.createBatch(form.affiliateId, form.method, form.currency))
    setShowCreate(false)
  }

  const columns: Column<PayoutRow>[] = [
    { key: 'affiliate', header: 'Affiliate', render: (r) => <span className="font-medium">{r.affiliate?.affiliateCode ?? r.affiliateId.slice(0, 8)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(Number(r.amount), r.currency) },
    { key: 'method', header: 'Method', render: (r) => <span className="capitalize">{r.method}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1 justify-end">
          {r.status === 'requested' && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(() => Payouts.approve(r.id))}>
              Approve
            </Button>
          )}
          {r.status === 'approved' && (
            <Button size="sm" disabled={busy !== null} onClick={() => act(() => Payouts.process(r.id))}>
              Process
            </Button>
          )}
          {['approved', 'processing'].includes(r.status) && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(() => Payouts.markPaid(r.id))}>
              Mark paid
            </Button>
          )}
          {['requested', 'approved'].includes(r.status) && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(() => Payouts.fail(r.id))}>
              Fail
            </Button>
          )}
        </div>
      ),
    },
    { key: 'createdAt', header: 'Created', render: (r) => shortDate(r.createdAt) },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Payouts"
        subtitle="Manage affiliate payout batches"
        actions={
          <Button onClick={() => setShowCreate(!showCreate)}>New batch</Button>
        }
      />

      {showCreate && (
        <div className="mb-3 rounded-lg border border-line bg-white p-3 shadow-card">
          <p className="text-sm font-medium mb-2">Create payout batch</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-2xs text-muted">Affiliate</label>
              <select
                className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                value={form.affiliateId}
                onChange={(e) => setForm({ ...form, affiliateId: e.target.value })}
              >
                <option value="">Select affiliate</option>
                {(affiliates.data?.items ?? []).map((a: any) => (
                  <option key={a.id} value={a.id}>{a.affiliateCode}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-2xs text-muted">Method</label>
              <select
                className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm capitalize"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              >
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-2xs text-muted">Currency</label>
              <input
                className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button onClick={createBatch} disabled={!form.affiliateId || busy !== null}>Create</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      <div className="mb-2">
        <FilterTabs
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'requested', label: 'Requested' },
            { value: 'approved', label: 'Approved' },
            { value: 'processing', label: 'Processing' },
            { value: 'paid', label: 'Paid' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </div>

      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No payouts yet" />
    </div>
  )
}
