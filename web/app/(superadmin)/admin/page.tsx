'use client'
import { SuperAdmin } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { StatCard } from '@/components/ui/stat-card'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

export default function PlatformOverviewPage() {
  const { data, loading } = useFetch(() => SuperAdmin.overview(), [])
  const maxSubs = Math.max(1, ...(data?.planDistribution.map((p) => p.subscribers) ?? [1]))

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Platform overview" subtitle="Everything across every tenant" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <StatCard label="MRR" value={money((data?.mrrCents ?? 0) / 100)} />
        <StatCard label="Active subscriptions" value={String(data?.activeSubscriptions ?? 0)} />
        <StatCard label="Tenants" value={String(data?.totalOrgs ?? 0)} />
        <StatCard label="Active tenants" value={String(data?.activeOrgs ?? 0)} />
        <StatCard label="Suspended" value={String(data?.suspendedOrgs ?? 0)} />
        <StatCard label="Users" value={String(data?.totalUsers ?? 0)} />
        <StatCard label="Affiliates" value={String(data?.totalAffiliates ?? 0)} />
      </div>
      <Card title="Plan distribution">
        {loading ? (
          <p className="text-xs text-muted">Loading...</p>
        ) : (data?.planDistribution.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">No plans yet</p>
        ) : (
          <ul className="space-y-2">
            {data!.planDistribution.map((p) => (
              <li key={p.key} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 font-medium truncate">{p.name}</span>
                <span className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(p.subscribers / maxSubs) * 100}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums text-muted">{p.subscribers}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
