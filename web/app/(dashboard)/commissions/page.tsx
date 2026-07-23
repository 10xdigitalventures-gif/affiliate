'use client'
import { useState } from 'react'
import { Commissions, CommissionRules } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { CommissionRow, RuleScope, CommissionType } from '@/lib/api'

export default function CommissionsPage() {
  const [status, setStatus] = useState('')
  const { data, loading, error, reload } = useFetch(
    () => Commissions.list(status || undefined),
    [status],
  )

  async function approve(id: string) {
    await Commissions.approve(id)
    reload()
  }
  async function reverse(id: string) {
    const reason = window.prompt('Reason for reversal?') || 'manual reversal'
    await Commissions.reverse(id, reason)
    reload()
  }

  const columns: Column<CommissionRow>[] = [
    { key: 'affiliate', header: 'Affiliate', render: (r) => <span className="font-medium">{r.affiliate?.affiliateCode ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount, r.currency) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'createdAt', header: 'Created', render: (r) => shortDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="inline-flex gap-1.5 justify-end">
          {r.status === 'pending' && <Button onClick={() => approve(r.id)}>Approve</Button>}
          {['pending', 'approved', 'payable', 'paid'].includes(r.status) && (
            <Button variant="danger" onClick={() => reverse(r.id)}>Reverse</Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Commissions" subtitle="Ledger — approve, lock and reverse" />
      <div className="mb-2">
        <FilterTabs
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'payable', label: 'Payable' },
            { value: 'paid', label: 'Paid' },
            { value: 'reversed', label: 'Reversed' },
          ]}
        />
      </div>
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data?.items ?? []} loading={loading} empty="No commissions yet" />

      <div className="mt-6">
        <CommissionRulesManager />
      </div>
    </div>
  )
}

const SCOPES: RuleScope[] = ['global', 'store', 'category', 'product', 'campaign', 'affiliate']
const TYPES: CommissionType[] = ['percentage', 'fixed', 'tiered', 'recurring']

function CommissionRulesManager() {
  const { data: rules, loading, error, reload } = useFetch(() => CommissionRules.list(), [])
  const [scope, setScope] = useState<RuleScope>('product')
  const [scopeRefId, setScopeRefId] = useState('')
  const [type, setType] = useState<CommissionType>('percentage')
  const [value, setValue] = useState('10')
  const [priority, setPriority] = useState('0')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const needsRef = scope !== 'global'

  async function create() {
    setBusy(true)
    setFormError(null)
    try {
      await CommissionRules.create({
        scope,
        scopeRefId: needsRef ? scopeRefId.trim() : undefined,
        type,
        value: Number(value),
        priority: Number(priority) || 0,
      })
      setScopeRefId('')
      setValue('10')
      setPriority('0')
      reload()
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create rule')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this commission rule?')) return
    await CommissionRules.remove(id)
    reload()
  }

  return (
    <Card title="Commission rules">
      <p className="text-xs text-muted mb-3">
        Set rates by scope. Priority (highest first) breaks ties; on equal priority the more specific scope wins
        (affiliate &gt; product &gt; category &gt; store &gt; campaign &gt; global). Product &amp; category rules apply per line item.
      </p>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-2xs text-muted">Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as RuleScope)} className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs">
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {needsRef && (
          <label className="text-2xs text-muted">{scope} ID
            <input value={scopeRefId} onChange={(e) => setScopeRefId(e.target.value)} placeholder={`${scope} id`} className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs font-mono w-56" />
          </label>
        )}
        <label className="text-2xs text-muted">Type
          <select value={type} onChange={(e) => setType(e.target.value as CommissionType)} className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-2xs text-muted">Value{type === 'percentage' ? ' (%)' : ''}
          <input value={value} onChange={(e) => setValue(e.target.value)} type="number" step="0.01" className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs w-24" />
        </label>
        <label className="text-2xs text-muted">Priority
          <input value={priority} onChange={(e) => setPriority(e.target.value)} type="number" className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs w-20" />
        </label>
        <Button disabled={busy || (needsRef && !scopeRefId.trim())} onClick={create}>{busy ? 'Adding…' : 'Add rule'}</Button>
      </div>
      {formError && <p className="text-xs text-danger mb-2">{formError}</p>}
      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      {loading ? (
        <p className="text-xs text-muted">Loading rules…</p>
      ) : (rules?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted">No rules yet — a global rule is a good default.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-1">Scope</th><th>Ref ID</th><th>Type</th><th className="text-right">Value</th><th className="text-right">Priority</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rules!.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="py-1 font-medium">{r.scope}</td>
                <td className="font-mono text-2xs">{r.scopeRefId ?? '—'}</td>
                <td>{r.type}</td>
                <td className="text-right">{r.type === 'percentage' ? `${r.value}%` : r.value}</td>
                <td className="text-right">{r.priority}</td>
                <td className="text-right"><Button variant="danger" onClick={() => remove(r.id)}>Delete</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
