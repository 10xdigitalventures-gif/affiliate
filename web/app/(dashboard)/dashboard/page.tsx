'use client'
import { Reports } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { StatCard } from '@/components/ui/stat-card'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { AreaChart } from '@/components/ui/area-chart'

export default function DashboardPage() {
  const summary = useFetch(() => Reports.summary({ days: 30 }), [])
  const series = useFetch(() => Reports.timeseries({ days: 30 }), [])
  const top = useFetch(() => Reports.topAffiliates(5), [])
  const s = summary.data

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Overview" subtitle="Last 30 days" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <StatCard label="Revenue" value={money(s?.revenue ?? 0)} />
        <StatCard label="Commissions" value={money(s?.commissions ?? 0)} />
        <StatCard label="Active affiliates" value={String(s?.activeAffiliates ?? 0)} />
        <StatCard label="Orders" value={String(s?.orders ?? 0)} />
      </div>
      <div className="grid lg:grid-cols-3 gap-2">
        <div className="lg:col-span-2">
          <Card title="Revenue vs commissions">
            <AreaChart data={series.data ?? []} />
          </Card>
        </div>
        <Card title="Top affiliates">
          {top.loading ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : (top.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No data yet</p>
          ) : (
            <ul className="space-y-1.5">
              {top.data!.map((a, i) => (
                <li key={a.affiliateId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="text-2xs text-muted w-3">{i + 1}</span>
                    <span className="font-medium">{a.affiliateCode}</span>
                  </span>
                  <span className="tabular-nums">{money(a.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
