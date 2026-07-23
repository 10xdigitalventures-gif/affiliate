'use client'
import { useMemo, useState } from 'react'
import { Reports, downloadCsv } from '@/lib/api'
import type { ReportRange } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { AreaChart } from '@/components/ui/area-chart'
import { StatCard } from '@/components/ui/stat-card'

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export default function ReportsPage() {
  const [days, setDays] = useState('30')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')

  const range: ReportRange = useMemo(() => {
    if (from && to) return { from, to }
    return { days: Number(days) || 30 }
  }, [days, from, to])

  const summary = useFetch(() => Reports.summary(range), [range.from, range.to, range.days])
  const series = useFetch(() => Reports.timeseries(range), [range.from, range.to, range.days])
  const top = useFetch(() => Reports.topAffiliates(10, range), [range.from, range.to, range.days])
  const stores = useFetch(() => Reports.byStore(range), [range.from, range.to, range.days])
  const products = useFetch(() => Reports.byProduct(8, range), [range.from, range.to, range.days])
  const categories = useFetch(() => Reports.byCategory(range), [range.from, range.to, range.days])
  const sources = useFetch(() => Reports.bySource(range), [range.from, range.to, range.days])
  const s = summary.data

  async function exportCsv(entity: 'commissions' | 'orders' | 'affiliates') {
    setBusy(entity)
    try {
      await downloadCsv(entity, range)
    } finally {
      setBusy('')
    }
  }

  function onDaysChange(v: string) {
    setDays(v)
    setFrom('')
    setTo('')
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Performance, breakdowns & exports"
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" disabled={busy !== ''} onClick={() => exportCsv('orders')}>
              {busy === 'orders' ? 'Exporting…' : 'Orders CSV'}
            </Button>
            <Button variant="outline" disabled={busy !== ''} onClick={() => exportCsv('commissions')}>
              {busy === 'commissions' ? 'Exporting…' : 'Commissions CSV'}
            </Button>
            <Button disabled={busy !== ''} onClick={() => exportCsv('affiliates')}>
              {busy === 'affiliates' ? 'Exporting…' : 'Affiliates CSV'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <FilterTabs
          value={from && to ? '' : days}
          onChange={onDaysChange}
          options={[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ]}
        />
        <label className="text-2xs text-muted">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs"
          />
        </label>
        <label className="text-2xs text-muted">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block mt-0.5 rounded-md border border-line px-2 py-1 text-xs"
          />
        </label>
        {(from || to) && (
          <Button
            variant="outline"
            onClick={() => {
              setFrom('')
              setTo('')
            }}
          >
            Clear dates
          </Button>
        )}
      </div>

      {summary.error && <p className="text-xs text-danger mb-2">{summary.error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
        <StatCard label="Revenue" value={money(s?.revenue ?? 0)} />
        <StatCard label="Commissions" value={money(s?.commissions ?? 0)} />
        <StatCard label="Orders" value={String(s?.orders ?? 0)} />
        <StatCard label="Clicks" value={String(s?.clicks ?? 0)} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <StatCard label="AOV" value={money(s?.aov ?? 0)} />
        <StatCard label="EPC" value={money(s?.epc ?? 0)} />
        <StatCard label="Conversion" value={pct(s?.conversionRate ?? 0)} />
        <StatCard label="Comm. rate" value={pct(s?.commissionRate ?? 0)} />
      </div>

      <div className="mb-3">
        <Card title={`Revenue vs commissions (${from && to ? `${from} → ${to}` : `${days}d`})`}>
          <AreaChart data={series.data ?? []} height={200} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card title="Top affiliates">
          {(top.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No affiliate data in range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="py-1">Code</th>
                    <th className="text-right">Comm.</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">EPC</th>
                    <th className="text-right">CR</th>
                  </tr>
                </thead>
                <tbody>
                  {(top.data ?? []).map((r) => (
                    <tr key={r.affiliateId} className="border-b border-line/60">
                      <td className="py-1 font-medium">{r.affiliateCode}</td>
                      <td className="text-right">{money(r.total)}</td>
                      <td className="text-right">{r.orders ?? 0}</td>
                      <td className="text-right">{money(r.epc ?? 0)}</td>
                      <td className="text-right">{pct(r.conversionRate ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="By store">
          {(stores.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No store data in range.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="py-1">Store</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Comm.</th>
                </tr>
              </thead>
              <tbody>
                {(stores.data ?? []).map((r) => (
                  <tr key={r.storeId} className="border-b border-line/60">
                    <td className="py-1">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted ml-1">{r.platform}</span>
                    </td>
                    <td className="text-right">{money(r.revenue)}</td>
                    <td className="text-right">{r.orders}</td>
                    <td className="text-right">{money(r.commissions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Top products">
          {(products.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No line-item product data (orders need items + products).</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="py-1">Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Comm.</th>
                </tr>
              </thead>
              <tbody>
                {(products.data ?? []).map((r) => (
                  <tr key={r.productId} className="border-b border-line/60">
                    <td className="py-1 font-medium">{r.name}</td>
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{money(r.revenue)}</td>
                    <td className="text-right">{money(r.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="By category">
          {(categories.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No category breakdown yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="py-1">Category</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Comm.</th>
                </tr>
              </thead>
              <tbody>
                {(categories.data ?? []).map((r) => (
                  <tr key={r.categoryId ?? 'none'} className="border-b border-line/60">
                    <td className="py-1 font-medium">{r.name}</td>
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{money(r.revenue)}</td>
                    <td className="text-right">{money(r.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-3">
        <Card title="Traffic sources">
          {(sources.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No source data in range. Orders appear here once visits carry UTM / ad parameters (Google, Meta, TikTok…) or an affiliate link — otherwise they count as Direct.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="py-1">Channel</th>
                    <th>Ad network</th>
                    <th>utm_source</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Attributed</th>
                    <th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(sources.data ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-1 font-medium capitalize">{r.channel}</td>
                      <td className="capitalize">{r.adNetwork ?? '—'}</td>
                      <td>{r.source ?? '—'}</td>
                      <td className="text-right">{r.orders}</td>
                      <td className="text-right">{r.attributedOrders}</td>
                      <td className="text-right">{money(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
