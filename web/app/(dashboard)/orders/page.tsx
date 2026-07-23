'use client'
import { Orders } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import type { OrderRow } from '@/lib/api'

export default function OrdersPage() {
  const { data, loading, error } = useFetch(() => Orders.list(), [])

  const columns: Column<OrderRow>[] = [
    { key: 'externalOrderId', header: 'Order', render: (r) => <span className="font-medium">#{r.externalOrderId}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total, r.currency) },
    { key: 'refundAmount', header: 'Refunded', align: 'right', render: (r) => (Number(r.refundAmount) ? money(r.refundAmount, r.currency) : '—') },
    { key: 'placedAt', header: 'Placed', render: (r) => shortDate(r.placedAt) },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Orders" subtitle="Normalised orders from all connected stores" />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data?.items ?? []} loading={loading} empty="No orders yet" />
    </div>
  )
}
