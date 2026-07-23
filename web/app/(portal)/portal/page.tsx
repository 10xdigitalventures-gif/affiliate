'use client'
import { Portal } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card } from '@/components/ui/card'

export default function PortalOverview() {
  const { data, loading, error } = useFetch(() => Portal.summary(), [])

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={data ? `Hi, ${data.affiliateCode}` : 'Overview'}
        subtitle="Your performance and earnings"
      />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <StatCard label="Available balance" value={money(data?.availableBalance ?? 0, data?.currency)} />
        <StatCard label="Pending" value={money(data?.pending ?? 0, data?.currency)} />
        <StatCard label="Lifetime earnings" value={money(data?.lifetimeEarnings ?? 0, data?.currency)} />
        <StatCard label="Conversion rate" value={`${data?.conversionRate ?? 0}%`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-2">
        <Card title="Activity">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted">Clicks</p>
              <p className="text-lg font-semibold tabular-nums">{data?.clicks ?? 0}</p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted">Conversions</p>
              <p className="text-lg font-semibold tabular-nums">{data?.conversions ?? 0}</p>
            </div>
          </div>
        </Card>
        <Card title="Your referral">
          {loading ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">Code</span>
                <span className="font-medium">{data?.affiliateCode}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Slug</span>
                <span className="font-mono text-xs">/{data?.referralSlug}</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
