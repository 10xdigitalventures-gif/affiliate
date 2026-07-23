'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Portal } from '@/lib/api'
import type { PortalCoupon } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'

export default function PortalCoupons() {
  const coupons = useFetch(() => Portal.coupons(), [])
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(code: string, id: string) {
    await navigator.clipboard.writeText(code)
    setCopied(id)
    window.setTimeout(() => setCopied(null), 1800)
  }

  const columns: Column<PortalCoupon>[] = [
    {
      key: 'code',
      header: 'Coupon code',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{row.code}</span>
          <button type="button" onClick={() => copy(row.code, row.id)} className="rounded p-1 text-muted hover:bg-gray-100" title="Copy coupon">
            {copied === row.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
        </div>
      ),
    },
    { key: 'store', header: 'Store', render: (row) => <span>{row.store.name}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill status={row.status} /> },
    { key: 'orders', header: 'Orders', align: 'right', render: (row) => row._count.orders },
    { key: 'expiresAt', header: 'Expires', render: (row) => row.expiresAt ? shortDate(row.expiresAt) : 'No expiry' },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Coupons & offers" subtitle="Codes assigned to your affiliate account" />
      {coupons.error && <p className="mb-2 text-xs text-danger">{coupons.error}</p>}
      <DataTable columns={columns} rows={coupons.data ?? []} loading={coupons.loading} empty="No coupons or offers assigned yet" />
    </div>
  )
}
