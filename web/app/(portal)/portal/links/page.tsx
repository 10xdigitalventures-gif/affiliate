'use client'
import { Portal } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import type { PortalLink } from '@/lib/api'

export default function PortalLinks() {
  const { data, loading, error } = useFetch(() => Portal.links(), [])

  const columns: Column<PortalLink>[] = [
    {
      key: 'shortCode',
      header: 'Tracking link',
      render: (r) => <span className="font-mono text-xs">/v1/track/r/{r.shortCode}</span>,
    },
    { key: 'destinationUrl', header: 'Destination', render: (r) => <span className="text-muted">{r.destinationUrl}</span> },
    { key: 'clicksCount', header: 'Clicks', align: 'right', render: (r) => r.clicksCount },
    { key: 'createdAt', header: 'Created', render: (r) => shortDate(r.createdAt) },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="My links" subtitle="Share these to earn commissions" />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No links yet" />
    </div>
  )
}
