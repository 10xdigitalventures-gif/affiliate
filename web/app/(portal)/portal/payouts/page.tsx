'use client'
import { useEffect, useState } from 'react'
import { Portal } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { PayoutRow, PayoutMethodRecord } from '@/lib/api'

const ALL_METHODS = ['bank', 'wise', 'paypal', 'stripe', 'manual', 'crypto']
const METHOD_FIELDS: Record<string, Array<{ key: string; label: string; type?: string }>> = {
  bank: [
    { key: 'accountHolder', label: 'Account holder' },
    { key: 'bankName', label: 'Bank name' },
    { key: 'accountNumber', label: 'Account number' },
    { key: 'routingNumber', label: 'Routing number (optional)' },
    { key: 'iban', label: 'IBAN (optional)' },
    { key: 'country', label: 'Country code' },
  ],
  wise: [{ key: 'recipientId', label: 'Wise recipient ID' }],
  paypal: [{ key: 'email', label: 'PayPal email', type: 'email' }],
  stripe: [{ key: 'accountId', label: 'Stripe connected account ID' }],
  manual: [{ key: 'instructions', label: 'Payment instructions' }],
  crypto: [
    { key: 'network', label: 'Network' },
    { key: 'walletAddress', label: 'Wallet address' },
  ],
}

export default function PortalPayouts() {
  const [requestBusy, setRequestBusy] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState('')
  const [newMethod, setNewMethod] = useState('bank')
  const [newDetails, setNewDetails] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const payouts = useFetch(() => Portal.payouts(), [])
  const methods = useFetch(() => Portal.payoutMethods(), [])

  useEffect(() => {
    const saved = methods.data ?? []
    if (!saved.length) {
      setSelectedMethod('')
      return
    }
    const preferred = saved.find((method) => method.isDefault) ?? saved[0]
    if (!saved.some((method) => method.method === selectedMethod)) setSelectedMethod(preferred.method)
  }, [methods.data, selectedMethod])

  async function requestPayout() {
    if (!selectedMethod) {
      setErr('Add a payout method before requesting a payout.')
      return
    }
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
      await Portal.addPayoutMethod(newMethod, newDetails)
      setNewDetails({})
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

  async function makeDefault(id: string) {
    setErr(null)
    try {
      const updated = await Portal.setDefaultPayoutMethod(id)
      setSelectedMethod(updated.method)
      await methods.refresh()
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
            <option value="">Select a saved method</option>
            {(methods.data ?? []).map((method) => <option key={method.id} value={method.method} className="capitalize">{method.method}{method.isDefault ? ' (default)' : ''}</option>)}
          </select>
          <Button disabled={requestBusy || !selectedMethod} onClick={requestPayout} className="w-full justify-center">
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
                <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="capitalize flex items-center gap-1.5">
                    {m.method}
                    {m.isDefault && <span className="text-2xs text-success">(default)</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    {!m.isDefault && <button onClick={() => makeDefault(m.id)} className="text-2xs text-brand hover:underline">Make default</button>}
                    <button onClick={() => removeMethod(m.id)} className="text-2xs text-danger hover:underline">Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2 pt-2 border-t border-line">
              <select
                className="w-full rounded-md border border-line px-2 py-1.5 text-xs capitalize"
                value={newMethod}
                onChange={(e) => { setNewMethod(e.target.value); setNewDetails({}) }}
              >
                {ALL_METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                {(METHOD_FIELDS[newMethod] ?? []).map((field) => (
                  <label key={field.key} className="text-2xs text-muted">
                    {field.label}
                    <input
                      type={field.type || 'text'}
                      value={newDetails[field.key] || ''}
                      onChange={(event) => setNewDetails((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-xs text-ink"
                    />
                  </label>
                ))}
              </div>
              <Button size="sm" variant="outline" disabled={addBusy} onClick={addMethod} className="w-full justify-center">
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
