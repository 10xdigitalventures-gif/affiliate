'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Stores } from '@/lib/api'
import type { StoreRow } from '@/lib/api'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100/v1').replace(/\/$/, '')

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-2xs leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-2xs text-gray-200 hover:bg-gray-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function ConnectStorePage() {
  // ── Shopify ──
  const [shop, setShop] = useState('')
  const [shopifyBusy, setShopifyBusy] = useState(false)
  const [shopifyErr, setShopifyErr] = useState<string | null>(null)

  async function installShopify() {
    setShopifyBusy(true)
    setShopifyErr(null)
    try {
      const normalized = shop.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const res = await Stores.shopifyInstallUrl(normalized)
      if (!res.configured) {
        setShopifyErr('Shopify app is not configured on the server yet. Set SHOPIFY_API_KEY / SHOPIFY_API_SECRET.')
        return
      }
      window.location.href = res.url
    } catch (e) {
      setShopifyErr((e as Error).message)
    } finally {
      setShopifyBusy(false)
    }
  }

  // ── Custom store ──
  const [customName, setCustomName] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [customBusy, setCustomBusy] = useState(false)
  const [customErr, setCustomErr] = useState<string | null>(null)
  const [created, setCreated] = useState<StoreRow | null>(null)

  async function createCustom() {
    setCustomBusy(true)
    setCustomErr(null)
    try {
      const store = await Stores.connect({
        platform: 'custom',
        name: customName || 'My custom store',
        domain: customDomain || 'example.com',
      })
      setCreated(store)
    } catch (e) {
      setCustomErr((e as Error).message)
    } finally {
      setCustomBusy(false)
    }
  }

  const storeId = created?.id || 'YOUR_STORE_ID'

  const captureSnippet =
    '<!-- Affiliate referral + paid/organic capture: add before </body> on every page -->\n' +
    '<script>\n' +
    '(function(){\n' +
    '  var q = location.search, C = function(n,v){document.cookie = n+"="+v+";path=/;max-age="+(60*60*24*60)};\n' +
    '  var m = q.match(/[?&]ref=([^&]+)/) || q.match(/[?&]aff=([^&]+)/);\n' +
    '  if (m) C("aff_ref", m[1]);\n' +
    '  var adIds = {gclid:"google",gbraid:"google",wbraid:"google",dclid:"google",fbclid:"meta",ttclid:"tiktok",msclkid:"microsoft",li_fat_id:"linkedin",twclid:"twitter",epik:"pinterest",sccid:"snapchat"};\n' +
    '  var ch="", net="";\n' +
    '  for (var k in adIds){ if (new RegExp("[?&]"+k+"=").test(q)){ ch="paid"; net=adIds[k]; break; } }\n' +
    '  var pm = /[?&]utm_medium=(cpc|ppc|paid|paidsocial|paid-social|paid_social|display|cpm|cpv|banner|retargeting|remarketing)/i;\n' +
    '  if (!ch && pm.test(q)) ch="paid";\n' +
    '  if (!ch && (m || /[?&]utm_source=/.test(q))) ch="organic";\n' +
    '  if (ch) { C("aff_channel", ch); if (net) C("aff_adnet", net); }\n' +
    '})();\n' +
    '</script>'

  const ingestSnippet =
    'curl -X POST "' + API_BASE + '/orders/ingest/apikey" \\\n' +
    '  -H "x-api-key: YOUR_API_KEY" \\\n' +
    '  -H "content-type: application/json" \\\n' +
    '  -d \'' +
    JSON.stringify({
      storeId,
      externalOrderId: '1001',
      subtotal: 100,
      total: 110,
      currency: 'USD',
      status: 'completed',
      referralCode: 'AFF_REF_FROM_COOKIE',
      couponCode: 'SAVE10',
      channel: 'paid',
      adNetwork: 'meta',
    }) +
    '\''

  const refundSnippet =
    'curl -X POST "' + API_BASE + '/orders/refund/apikey" \\\n' +
    '  -H "x-api-key: YOUR_API_KEY" \\\n' +
    '  -H "content-type: application/json" \\\n' +
    '  -d \'' +
    JSON.stringify({ storeId, externalOrderId: '1001', refundAmount: 110 }) +
    '\''

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Connect a store"
        subtitle="Choose how you want to send orders into your affiliate program"
        actions={
          <Link href="/stores">
            <Button variant="outline">Back to stores</Button>
          </Link>
        }
      />

      {/* ── Shopify ── */}
      <Card title="Shopify — 1-click app install" className="mb-3">
        <p className="text-sm text-muted mb-2">
          Install our Shopify app on your store. You&apos;ll be redirected to Shopify to approve access, and
          webhooks for orders &amp; refunds are registered automatically. No keys to copy.
        </p>
        <label className="text-2xs text-muted">Your Shopify store domain</label>
        <div className="flex gap-2 mt-0.5">
          <input
            className="w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            placeholder="my-shop.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
          />
          <Button disabled={shopifyBusy || !shop.trim()} onClick={installShopify}>
            {shopifyBusy ? 'Redirecting…' : 'Install app'}
          </Button>
        </div>
        {shopifyErr && <p className="text-xs text-danger mt-2">{shopifyErr}</p>}
      </Card>

      {/* ── WooCommerce ── */}
      <Card title="WooCommerce — plugin" className="mb-3">
        <p className="text-sm text-muted mb-2">
          Install our WordPress plugin. It self-registers your store, captures referral cookies, and pushes
          orders &amp; refunds automatically.
        </p>
        <ol className="list-decimal pl-5 text-sm text-ink space-y-1">
          <li>
            Download the plugin:{' '}
            <a href="/downloads/affiliate-platform-woocommerce.zip" className="text-brand underline">
              affiliate-platform-woocommerce.zip
            </a>
          </li>
          <li>In WordPress admin, go to <strong>Plugins → Add New → Upload Plugin</strong> and upload the zip.</li>
          <li>Activate <strong>Affiliate Platform Connector</strong>.</li>
          <li>
            Go to <strong>WooCommerce → Affiliate Platform</strong>, paste your API base URL
            (<code>{API_BASE}</code>) and an API key, then click <strong>Save &amp; Connect</strong>.
          </li>
          <li>Done — the plugin registers the store and starts sending orders.</li>
        </ol>
        <p className="text-2xs text-muted mt-2">
          Create an API key with the <code>stores.write</code> and <code>orders.write</code> scopes under{' '}
          <Link href="/settings/api-keys" className="text-brand underline">Settings → API keys</Link>.
        </p>
      </Card>

      {/* ── Custom / headless ── */}
      <Card title="Custom / headless store">
        <p className="text-sm text-muted mb-2">
          Any platform (Magento, BigCommerce, custom checkout…). Create a store record, drop in the referral
          snippet, and post orders to our API.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-2xs text-muted">Store name</label>
            <input
              className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              placeholder="My custom store"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-2xs text-muted">Domain</label>
            <input
              className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              placeholder="example.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
            />
          </div>
        </div>
        <Button disabled={customBusy} onClick={createCustom}>
          {customBusy ? 'Creating…' : created ? 'Store created ✓' : 'Create custom store'}
        </Button>
        {customErr && <p className="text-xs text-danger mt-2">{customErr}</p>}

        <div className="mt-4">
          <p className="text-xs font-medium text-ink">1. Referral capture snippet (add to every page)</p>
          <CodeBlock code={captureSnippet} />
        </div>
        <div className="mt-3">
          <p className="text-xs font-medium text-ink">2. Send an order (server-side, on checkout)</p>
          <CodeBlock code={ingestSnippet} />
        </div>
        <div className="mt-3">
          <p className="text-xs font-medium text-ink">3. Send a refund</p>
          <CodeBlock code={refundSnippet} />
        </div>
        <p className="text-2xs text-muted mt-3">
          Read the <code>aff_ref</code> cookie server-side and pass it as <code>referralCode</code> when posting
          the order. Use an API key with <code>orders.write</code> scope.
          {created ? ` Your store ID: ${created.id}` : ''}
        </p>
      </Card>
    </div>
  )
}
