'use client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { setTokens, ShopifyApp } from '@/lib/api'

declare global {
  interface Window {
    shopify?: { idToken?: () => Promise<string> } & Record<string, unknown>
  }
  namespace JSX {
    interface IntrinsicElements {
      'ui-nav-menu': any
    }
  }
}

const API_KEY = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || ''

type Status = 'loading' | 'ready' | 'error' | 'standalone'

// Embedded (in-Shopify-admin) shell. Loads App Bridge from Shopify CDN (no npm
// dependency), exchanges the Shopify session token for a platform JWT, then
// renders the SAME dashboard pages inside the Shopify admin iframe. The
// standalone dashboard at /dashboard keeps working unchanged (hybrid).
export default function EmbeddedLayout({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    if (API_KEY && !document.querySelector('meta[name="shopify-api-key"]')) {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'shopify-api-key')
      meta.setAttribute('content', API_KEY)
      document.head.appendChild(meta)
    }
    if (!document.getElementById('shopify-app-bridge')) {
      const script = document.createElement('script')
      script.id = 'shopify-app-bridge'
      script.src = 'https://cdn.shopify.com/shopifycloud/app-bridge.js'
      document.head.appendChild(script)
    }

    async function boot() {
      const start = Date.now()
      while (!(window.shopify && typeof window.shopify.idToken === 'function') && Date.now() - start < 6000) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (cancelled) return
      if (!(window.shopify && typeof window.shopify.idToken === 'function')) {
        setStatus('standalone')
        return
      }
      try {
        const sessionToken = await window.shopify.idToken()
        const res = await ShopifyApp.tokenExchange(sessionToken)
        setTokens(res.access_token, res.refresh_token)
        window.localStorage.setItem('user', JSON.stringify(res.user))
        if (!cancelled) setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setMessage((err as Error).message || 'Could not start the embedded session')
        }
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen">
      <ui-nav-menu>
        <a href="/embedded" rel="home">Overview</a>
        <a href="/embedded/affiliates">Affiliates</a>
        <a href="/embedded/stores">Stores</a>
        <a href="/embedded/commissions">Commissions</a>
        <a href="/embedded/payouts">Payouts</a>
        <a href="/embedded/tax">Tax and 1099</a>
        <a href="/embedded/settings">Settings</a>
      </ui-nav-menu>

      {status === 'ready' ? (
        <div className="p-4">{children}</div>
      ) : (
        <div className="flex h-screen items-center justify-center p-6 text-center">
          {status === 'loading' && <div className="text-sm text-muted">Connecting to your Shopify admin...</div>}
          {status === 'standalone' && (
            <div className="max-w-sm">
              <p className="text-sm text-ink">This is the embedded Shopify experience.</p>
              <p className="mt-1 text-xs text-muted">Open the app from your Shopify admin, or use the standalone dashboard.</p>
              <a className="mt-3 inline-block rounded-md border border-line px-3 py-1.5 text-xs text-ink" href="/dashboard">Go to standalone dashboard</a>
            </div>
          )}
          {status === 'error' && (
            <div className="max-w-sm">
              <p className="text-sm text-danger">Could not connect</p>
              <p className="mt-1 text-xs text-muted">{message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
