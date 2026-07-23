'use client'
import { useState } from 'react'
import { Fraud } from '@/lib/api'
import { useFetch, money, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { FraudReview, FraudSettings } from '@/lib/api'

export default function FraudPage() {
  const [status, setStatus] = useState('open')
  const { data: reviews, loading, error, reload } = useFetch(
    () => Fraud.reviews(status || undefined),
    [status],
  )
  const { data: settings, reload: reloadSettings } = useFetch(() => Fraud.settings(), [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [thresholds, setThresholds] = useState<{ review?: string; block?: string }>({})

  async function act(id: string, kind: 'approve' | 'reject') {
    setBusyId(id)
    try {
      if (kind === 'approve') await Fraud.approve(id)
      else await Fraud.reject(id)
      reload()
    } finally {
      setBusyId(null)
    }
  }

  async function saveThresholds() {
    if (!settings) return
    setSettingsBusy(true)
    try {
      const body: Partial<FraudSettings> = {}
      if (thresholds.review !== undefined && thresholds.review !== '') body.reviewThreshold = Number(thresholds.review)
      if (thresholds.block !== undefined && thresholds.block !== '') body.blockThreshold = Number(thresholds.block)
      await Fraud.updateSettings(body)
      setThresholds({})
      reloadSettings()
    } finally {
      setSettingsBusy(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Fraud reviews"
        subtitle="Risk-scored conversions held for manual review or hard-blocked"
      />

      {settings && (
        <div className="mb-4"><Card title="Thresholds">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <div>
              <p className="text-muted mb-0.5">Review ≥</p>
              <input
                type="number"
                className="w-20 rounded-md border border-line px-2 py-1"
                defaultValue={settings.reviewThreshold}
                onChange={(e) => setThresholds((t) => ({ ...t, review: e.target.value }))}
              />
            </div>
            <div>
              <p className="text-muted mb-0.5">Block ≥</p>
              <input
                type="number"
                className="w-20 rounded-md border border-line px-2 py-1"
                defaultValue={settings.blockThreshold}
                onChange={(e) => setThresholds((t) => ({ ...t, block: e.target.value }))}
              />
            </div>
            <p className="text-muted self-center">
              Velocity: {settings.orderVelocityLimit} orders / {settings.orderVelocityWindowHours}h ·
              {' '}{settings.ipVelocityLimit} clicks / {settings.ipVelocityWindowMinutes}m
            </p>
            <Button disabled={settingsBusy} onClick={saveThresholds}>
              {settingsBusy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card></div>
      )}

      <div className="mb-3">
        <FilterTabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: '', label: 'All' },
          ]}
        />
      </div>

      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      {loading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : (reviews?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted">No fraud reviews in this filter.</p>
      ) : (
        <div className="space-y-2">
          {(reviews as FraudReview[]).map((r) => (
            <div key={r.id} className="rounded-lg border border-line bg-white p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Score {r.score}</span>
                  <StatusPill status={r.decision} />
                  <StatusPill status={r.status} />
                  <span className="text-muted">{shortDate(r.createdAt)}</span>
                </div>
                {r.status === 'open' && (
                  <div className="flex gap-1.5">
                    <Button disabled={busyId === r.id} onClick={() => act(r.id, 'approve')}>
                      Approve
                    </Button>
                    <Button variant="danger" disabled={busyId === r.id} onClick={() => act(r.id, 'reject')}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
                <span>
                  Order{' '}
                  <span className="font-medium text-ink">
                    #{r.order?.externalOrderId ?? r.id.slice(0, 8)}
                  </span>
                  {r.order ? ` · ${money(r.order.total, r.order.currency)}` : ''}
                </span>
                <span>
                  Affiliate{' '}
                  <span className="font-medium text-ink">{r.affiliate?.affiliateCode ?? '—'}</span>
                </span>
                <span>Reasons: {(r.reasons ?? []).join(', ') || '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
