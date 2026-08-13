'use client'
import { Search, ChevronDown } from 'lucide-react'
import { NotificationBell } from './notification-bell'

export function Topbar() {
  return (
    <header className="flex items-center gap-3 h-12 px-4 border-b border-line bg-white">
      <div className="flex items-center gap-2 flex-1 max-w-sm rounded-md bg-gray-50 px-2.5 py-1.5">
        <Search size={14} className="text-muted" />
        <input
          className="bg-transparent text-sm outline-none w-full"
          placeholder="Search…"
          aria-label="Search"
        />
      </div>
      <NotificationBell />
      <button className="flex items-center gap-1.5 rounded-md hover:bg-gray-50 px-1.5 py-1 cursor-pointer">
        <div className="h-6 w-6 rounded-full bg-brand/10 text-brand grid place-items-center text-2xs font-semibold">
          DA
        </div>
        <span className="text-sm">Demo Admin</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
    </header>
  )
}
