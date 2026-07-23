'use client'
import { Portal } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import type { CommissionRow } from '@/lib/api'

export default function PortalEarnings() {
  const { data, loading, error } = useFetch(() => Portal.commissions(), [])

  const columns: Column<CommissionRow>[] = [
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount, r.currency) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'createdAt', header: 'Date', render: (r) => shortDate(r.createdAt) },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Earnings" subtitle="Your commission ledger" />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No commissions yet" />
    </div>
  )
}
