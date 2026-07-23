'use client'
import { Portal } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import type { OrderRow } from '@/lib/api'

export default function PortalOrders() {
  const { data, loading, error } = useFetch(() => Portal.orders(), [])

  const columns: Column<OrderRow>[] = [
    { key: 'externalOrderId', header: 'Order', render: (r) => <span className="font-medium">#{r.externalOrderId}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total, r.currency) },
    { key: 'placedAt', header: 'Placed', render: (r) => shortDate(r.placedAt) },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Orders" subtitle="Orders attributed to you" />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No orders yet" />
    </div>
  )
}
