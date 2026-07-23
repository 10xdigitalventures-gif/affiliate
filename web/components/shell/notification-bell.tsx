'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { Notifications, type NotificationRow } from '@/lib/api'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  async function loadCount() {
    try {
      const { count } = await Notifications.unreadCount()
      setCount(count)
    } catch {
      /* ignore — bell degrades silently */
    }
  }

  async function loadItems() {
    setLoading(true)
    try {
      setItems(await Notifications.list(false, 10))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  // Poll the unread badge every 30s.
  useEffect(() => {
    loadCount()
    const t = setInterval(loadCount, 30000)
    return () => clearInterval(t)
  }, [])

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) loadItems()
  }

  async function markRead(n: NotificationRow) {
    if (n.readAt) return
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)))
    setCount((c) => Math.max(0, c - 1))
    try {
      await Notifications.markRead(n.id)
    } catch {
      /* optimistic — ignore */
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))
    setCount(0)
    try {
      await Notifications.markAllRead()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-1.5 rounded-md hover:bg-gray-50 cursor-pointer"
        aria-label="Notifications"
      >
        <Bell size={16} className="text-muted" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-brand text-white text-[9px] font-semibold grid place-items-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-80 rounded-lg border border-line bg-white shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {count > 0 && (
              <button onClick={markAll} className="text-xs text-brand hover:underline cursor-pointer">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto">
            {loading ? (
              <p className="px-3 py-6 text-center text-xs text-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted">You’re all caught up 🎉</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`w-full text-left px-3 py-2.5 border-b border-line last:border-0 hover:bg-gray-50 cursor-pointer ${
                    n.readAt ? '' : 'bg-brand/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand shrink-0" />}
                    <div className={n.readAt ? 'pl-3.5' : ''}>
                      <p className="text-xs font-medium text-ink">{n.title}</p>
                      {n.body && <p className="text-2xs text-muted mt-0.5">{n.body}</p>}
                      <p className="text-2xs text-muted mt-0.5">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-center text-xs text-brand border-t border-line hover:bg-gray-50 cursor-pointer"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  )
}
