'use client'
import { useState } from 'react'
import Link from 'next/link'
import { SuperAdmin } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, type Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import type { AdminTenant } from '@/lib/api'

export default function TenantsPage() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, loading, reload } = useFetch(() => SuperAdmin.tenants(q || undefined), [q])

  async function toggleStatus(t: AdminTenant) {
    const next = t.status === 'suspended' ? 'active' : 'suspended'
    if (next === 'suspended' && !confirm(`Suspend ${t.name}? Their users will lose access.`)) return
    await SuperAdmin.setStatus(t.id, next)
    reload()
  }

  const columns: Column<AdminTenant>[] = [
    { key: 'name', header: 'Tenant', render: (t) => (
      <Link href={`/admin/tenants/${t.id}`} className="font-medium text-brand hover:underline">{t.name}</Link>
    ) },
    { key: 'slug', header: 'Slug', render: (t) => <span className="text-muted">{t.slug}</span> },
    { key: 'plan', header: 'Plan', render: (t) => t.plan ? t.plan.name : <span className="text-muted">-</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill status={t.status} /> },
    { key: 'affiliates', header: 'Affiliates', align: 'right', render: (t) => t.counts.affiliates },
    { key: 'stores', header: 'Stores', align: 'right', render: (t) => t.counts.stores },
    { key: 'users', header: 'Users', align: 'right', render: (t) => t.counts.users },
    { key: 'createdAt', header: 'Joined', render: (t) => shortDate(t.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (t) => (
      <Button variant={t.status === 'suspended' ? 'outline' : 'danger'} onClick={() => toggleStatus(t)}>
        {t.status === 'suspended' ? 'Activate' : 'Suspend'}
      </Button>
    ) },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Tenants" subtitle="Every organization on the platform" actions={
        <form onSubmit={(e) => { e.preventDefault(); setQ(search) }} className="flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug"
            className="rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand"
          />
          <Button variant="outline" type="submit">Search</Button>
        </form>
      } />
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No tenants found" />
    </div>
  )
}
