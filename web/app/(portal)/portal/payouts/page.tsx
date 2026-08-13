'use client'
import { useState } from 'react'
import { Portal } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { PayoutRow, PayoutMethodRecord } from '@/lib/api'

const ALL_METHODS = ['bank', 'wise', 'paypal', 'stripe', 'manual', 'crypto']

export default function PortalPayouts() {
  const [requestBusy, setRequestBusy] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState('bank')
  const [newMethod, setNewMethod] = useState('bank')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const payouts = useFetch(() => Portal.payouts(), [])
  const methods = useFetch(() => Portal.payoutMethods(), [])

  async function requestPayout() {
    setRequestBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await Portal.requestPayout(selectedMethod)
      setMsg(`Payout requested: ${money(res.amount)} via ${selectedMethod}`)
      payouts.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRequestBusy(false)
    }
  }

  async function addMethod() {
    setAddBusy(true)
    try {
      await Portal.addPayoutMethod(newMethod)
      methods.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setAddBusy(false)
    }
  }

  async function removeMethod(id: string) {
    try {
      await Portal.deletePayoutMethod(id)
      methods.refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const columns: Column<PayoutRow>[] = [
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(Number(r.amount), r.currency) },
    { key: 'method', header: 'Method', render: (r) => <span className="capitalize">{r.method}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'createdAt', header: 'Requested', render: (r) => shortDate(r.createdAt) },
    { key: 'ref', header: 'Reference', render: (r) => <span className="text-muted text-xs">{r.transactionReference ?? '—'}</span> },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Payouts" subtitle="Request payouts and manage payment methods" />
      <div className="grid lg:grid-cols-3 gap-2 mb-3">
        <Card title="Request payout">
          <p className="text-xs text-muted mb-2">From your payable commissions</p>
          <label className="text-2xs text-muted">Method</label>
          <select
            className="mt-0.5 mb-2 w-full rounded-md border border-line px-2 py-1.5 text-sm capitalize"
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
          >
            {ALL_METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
          </select>
          <Button disabled={requestBusy} onClick={requestPayout} className="w-full justify-center">
            {requestBusy ? 'Requesting...' : 'Request payout'}
          </Button>
          {msg && <p className="text-xs text-success mt-1">{msg}</p>}
          {err && <p className="text-xs text-danger mt-1">{err}</p>}
        </Card>

        <div className="lg:col-span-2">
          <Card title="Payment methods">
            <div className="space-y-1 mb-2">
              {methods.loading && <p className="text-xs text-muted">Loading...</p>}
              {(methods.data ?? []).length === 0 && !methods.loading && (
                <p className="text-xs text-muted">No methods saved yet</p>
              )}
              {(methods.data ?? []).map((m: PayoutMethodRecord) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span className="capitalize flex items-center gap-1.5">
                    {m.method}
                    {m.isDefault && <span className="text-2xs text-success">(default)</span>}
                  </span>
                  <button
                    onClick={() => removeMethod(m.id)}
                    className="text-2xs text-danger hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1 border-t border-line">
              <select
                className="flex-1 rounded-md border border-line px-2 py-1 text-xs capitalize"
                value={newMethod}
                onChange={(e) => setNewMethod(e.target.value)}
              >
                {ALL_METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={addBusy} onClick={addMethod}>
                {addBusy ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <DataTable columns={columns} rows={payouts.data ?? []} loading={payouts.loading} empty="No payouts yet" />
    </div>
  )
}
