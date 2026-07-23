'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, ChevronDown, LogOut, Search, ShieldCheck, UserRound } from 'lucide-react'
import { Auth, AuthUser } from '@/lib/api'
import { NotificationBell } from './notification-bell'

function initials(name?: string | null, email?: string) {
  const source = name?.trim() || email?.split('@')[0] || 'Account'
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase()
}

function Avatar({ user, size = 'sm' }: { user: AuthUser | null; size?: 'sm' | 'md' }) {
  const dimensions = size === 'md' ? 'h-9 w-9 text-xs' : 'h-7 w-7 text-2xs'
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt="Profile"
        className={`${dimensions} rounded-full border border-line object-cover`}
      />
    )
  }
  return (
    <span className={`${dimensions} grid shrink-0 place-items-center rounded-full bg-brand/10 font-semibold text-brand`}>
      {initials(user?.fullName, user?.email)}
    </span>
  )
}

export function Topbar({ title }: { title?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const cached = window.localStorage.getItem('user')
    if (cached) {
      try { setUser(JSON.parse(cached)) } catch { window.localStorage.removeItem('user') }
    }

    Auth.me().then(setUser).catch(() => undefined)

    function onProfileUpdated(event: Event) {
      const detail = (event as CustomEvent<AuthUser>).detail
      if (detail) setUser(detail)
    }
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('profile-updated', onProfileUpdated)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('profile-updated', onProfileUpdated)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const inPlatformConsole = pathname === '/admin' || pathname.startsWith('/admin/')
  const profileHref = user?.isSuperAdmin && inPlatformConsole
    ? '/admin/profile'
    : user?.affiliateId && (user.permissions?.length ?? 0) === 0
      ? '/portal/profile'
      : '/profile'

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await Auth.logout()
    } catch {
      // Local tokens are still cleared by Auth.logout's finally block.
    } finally {
      window.localStorage.removeItem('user')
      setOpen(false)
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <header className="flex h-12 w-full items-center gap-3 border-b border-line bg-white px-4">
      {title ? (
        <span className="text-sm font-medium">{title}</span>
      ) : (
        <div className="flex w-full max-w-sm items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1.5">
          <Search size={14} className="text-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search…"
            aria-label="Search"
          />
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-gray-50"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Avatar user={user} />
            <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
              {user?.fullName || user?.email || 'Account'}
            </span>
            <ChevronDown size={14} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-white shadow-lift"
            >
              <div className="flex items-center gap-3 border-b border-line px-3 py-3">
                <Avatar user={user} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user?.fullName || 'Your account'}</p>
                  <p className="truncate text-xs text-muted">{user?.email || 'Loading…'}</p>
                </div>
              </div>
              <div className="p-1.5">
                {user?.isSuperAdmin && (
                  <Link
                    href={inPlatformConsole ? '/dashboard' : '/admin'}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink transition hover:bg-gray-50"
                  >
                    {inPlatformConsole ? <Building2 size={15} className="text-muted" /> : <ShieldCheck size={15} className="text-muted" />}
                    {inPlatformConsole ? 'Organization dashboard' : 'Platform console'}
                  </Link>
                )}
                <Link
                  href={profileHref}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink transition hover:bg-gray-50"
                >
                  <UserRound size={15} className="text-muted" />
                  Profile settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={logout}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-danger transition hover:bg-danger/5 disabled:opacity-50"
                >
                  <LogOut size={15} />
                  {loggingOut ? 'Signing out…' : 'Logout'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
