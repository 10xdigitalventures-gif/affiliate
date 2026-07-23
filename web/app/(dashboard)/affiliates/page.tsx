'use client'
import { useState } from 'react'
import { Affiliates, Applications } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Button } from '@/components/ui/button'
import type { Affiliate, ApplicationRow } from '@/lib/api'

type Tab = 'affiliates' | 'applications'

export default function AffiliatesPage() {
  const [tab, setTab] = useState<Tab>('affiliates')
  const [status, setStatus] = useState('')
  const [appStatus, setAppStatus] = useState('')

  const { data, loading, error, reload } = useFetch(
    () => Affiliates.list(status || undefined),
    [status],
  )
  const { data: apps, loading: appsLoading, reload: reloadApps } = useFetch(
    () => Applications.list(appStatus || undefined),
    [appStatus],
  )

  async function approve(id: string) {
    await Affiliates.approve(id)
    reload()
  }

  async function approveApp(id: string) {
    await Applications.approve(id)
    reloadApps()
  }

  async function rejectApp(id: string) {
    await Applications.reject(id)
    reloadApps()
  }

  const pendingCount = apps?.filter((a) => a.status === 'pending').length ?? 0

  const affCols: Column<Affiliate>[] = [
    { key: 'affiliateCode', header: 'Code', render: (r) => <span className="font-medium">{r.affiliateCode}</span> },
    { key: 'referralSlug', header: 'Slug', render: (r) => <span className="text-muted">/{r.referralSlug}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'lifetimeEarnings', header: 'Lifetime', align: 'right', render: (r) => money(r.lifetimeEarnings) },
    { key: 'availableBalance', header: 'Balance', align: 'right', render: (r) => money(r.availableBalance) },
    { key: 'createdAt', header: 'Joined', render: (r) => shortDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'pending' ? (
          <Button onClick={() => approve(r.id)}>Approve</Button>
        ) : null,
    },
  ]

  const appCols: Column<ApplicationRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => {
        const p = r.payload as { firstName?: string; lastName?: string } | null
        return <span className="font-medium">{p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '—'}</span>
      },
    },
    { key: 'email', header: 'Email', render: (r) => <span className="text-muted text-xs">{r.email}</span> },
    {
      key: 'website',
      header: 'Website',
      render: (r) => {
        const p = r.payload as { website?: string } | null
        return p?.website ? (
          <a href={p.website} target="_blank" rel="noreferrer" className="text-brand text-xs hover:underline">
            {p.website.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-muted">—</span>
        )
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'createdAt', header: 'Applied', render: (r) => shortDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'pending' ? (
          <div className="flex gap-1.5 justify-end">
            <Button onClick={() => approveApp(r.id)}>Approve</Button>
            <Button variant="outline" onClick={() => rejectApp(r.id)}>Reject</Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Affiliates"
        subtitle="Manage affiliates and incoming applications"
        actions={
          <div className="flex gap-1.5">
            <Button
              variant={tab === 'applications' ? 'primary' : 'outline'}
              onClick={() => setTab('applications')}
            >
              Applications{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Button>
            <Button variant={tab === 'affiliates' ? 'primary' : 'outline'} onClick={() => setTab('affiliates')}>
              Affiliates
            </Button>
          </div>
        }
      />

      {tab === 'affiliates' && (
        <>
          <div className="mb-2">
            <FilterTabs
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'active', label: 'Active' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          </div>
          {error && <p className="text-xs text-danger mb-2">{error}</p>}
          <DataTable columns={affCols} rows={data?.items ?? []} loading={loading} empty="No affiliates yet" />
        </>
      )}

      {tab === 'applications' && (
        <>
          <div className="mb-2">
            <FilterTabs
              value={appStatus}
              onChange={setAppStatus}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          </div>
          <DataTable
            columns={appCols}
            rows={apps ?? []}
            loading={appsLoading}
            empty="No applications yet"
          />
        </>
      )}
    </div>
  )
}
