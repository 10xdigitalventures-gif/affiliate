'use client'
import { useState } from 'react'
import { Notifications, type NotificationRow } from '@/lib/api'
import { useFetch } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'

function fullTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const { data, loading, reload } = useFetch<NotificationRow[]>(
    () => Notifications.list(filter === 'unread', 100),
    [filter],
  )
  const [busy, setBusy] = useState(false)

  const items = data ?? []
  const hasUnread = items.some((n) => !n.readAt)

  async function markOne(n: NotificationRow) {
    if (n.readAt) return
    await Notifications.markRead(n.id).catch(() => {})
    reload()
  }

  async function markAll() {
    setBusy(true)
    await Notifications.markAllRead().catch(() => {})
    setBusy(false)
    reload()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        subtitle="Commission approvals, payouts, and new affiliate applications"
        actions={
          hasUnread ? (
            <Button variant="outline" onClick={markAll} disabled={busy}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <FilterTabs
        value={filter}
        onChange={(v) => setFilter(v as 'all' | 'unread')}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' },
        ]}
      />

      <Card>
        {loading ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {items.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 py-3 px-1 ${n.readAt ? '' : 'bg-brand/5 -mx-1 rounded'}`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.readAt ? 'bg-gray-200' : 'bg-brand'}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  {n.body && <p className="text-xs text-muted mt-0.5">{n.body}</p>}
                  <p className="text-2xs text-muted mt-1">{fullTime(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <button
                    onClick={() => markOne(n)}
                    className="text-xs text-brand hover:underline cursor-pointer shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
