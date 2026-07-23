'use client'
import { useState } from 'react'
import { TenantBilling, GATEWAY_CATALOG, type GatewayConfig, type GatewayProviderKey } from '@/lib/api'
import { useFetch } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const INPUT = 'w-full rounded-md border border-line px-2.5 py-1.5 text-sm'
const LABEL = 'block text-2xs font-medium text-muted mb-1'

export default function PaymentsPage() {
  const { data, loading, refresh } = useFetch(() => TenantBilling.configs(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [form, setForm] = useState({
    provider: 'swich' as GatewayProviderKey,
    label: '',
    companyId: '',
    apiKey: '',
    webhookSecret: '',
    isLive: false,
  })

  const [payout, setPayout] = useState({
    configId: '',
    amount: '',
    currency: 'PKR',
    destination: '{\n  "account": ""\n}',
    reference: '',
    purpose: 'affiliate_payout',
  })

  const configs = data ?? []
  const meta = (p: GatewayProviderKey) => GATEWAY_CATALOG.find((g) => g.key === p)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setNotice(null)
    try { await fn(); setNotice(ok); refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function addGateway() {
    if (!form.apiKey) { setError('API key is required'); return }
    await run(async () => {
      await TenantBilling.createConfig({
        provider: form.provider,
        label: form.label || undefined,
        companyId: form.companyId || undefined,
        apiKey: form.apiKey,
        webhookSecret: form.webhookSecret || undefined,
        isLive: form.isLive,
      })
      setForm({ provider: form.provider, label: '', companyId: '', apiKey: '', webhookSecret: '', isLive: false })
    }, 'Gateway saved.')
  }

  async function sendPayout() {
    const cents = Math.round(parseFloat(payout.amount || '0') * 100)
    if (!payout.configId) { setError('Pick a gateway'); return }
    if (!cents || cents < 1) { setError('Enter a valid amount'); return }
    let destination: Record<string, unknown> = {}
    try { destination = JSON.parse(payout.destination || '{}') }
    catch { setError('Destination must be valid JSON'); return }
    await run(() => TenantBilling.createPayout({
      configId: payout.configId,
      amountCents: cents,
      currency: payout.currency || undefined,
      destination,
      reference: payout.reference || undefined,
      purpose: payout.purpose || undefined,
    }), 'Payout submitted.')
  }

  const payoutConfigs = configs.filter((c) => c.isActive && meta(c.provider)?.supportsPayouts)

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="Payments" subtitle="Connect your own Whop / Swich accounts to charge and pay out through your gateway." />

      {error && <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}
      {notice && <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">{notice}</div>}

      <Card title="Connected gateways">
        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : configs.length === 0 ? (
          <p className="text-sm text-muted">No gateways connected yet. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {configs.map((c: GatewayConfig) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border border-line p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{meta(c.provider)?.name ?? c.provider}</span>
                    <span className="text-2xs rounded px-1.5 py-0.5 bg-surface text-muted">{c.isLive ? 'Live' : 'Test'}</span>
                    {!c.isActive && <span className="text-2xs rounded px-1.5 py-0.5 bg-surface text-muted">Disabled</span>}
                  </div>
                  {c.label && <div className="text-2xs text-muted mt-0.5">{c.label}</div>}
                  <div className="text-2xs text-muted mt-0.5 break-all">Webhook: {c.webhookUrl}</div>
                </div>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => TenantBilling.deleteConfig(c.id), 'Gateway removed.')}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add a gateway">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Provider</label>
            <select className={INPUT} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as GatewayProviderKey })}>
              {GATEWAY_CATALOG.map((g) => <option key={g.key} value={g.key}>{g.name} - {g.region}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Label (optional)</label>
            <input className={INPUT} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Main payout account" />
          </div>
          <div>
            <label className={LABEL}>Company / Merchant ID</label>
            <input className={INPUT} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>API key</label>
            <input className={INPUT} type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Webhook secret (optional)</label>
            <input className={INPUT} type="password" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isLive} onChange={(e) => setForm({ ...form, isLive: e.target.checked })} />
              Live mode
            </label>
          </div>
        </div>
        <p className="text-2xs text-muted mt-2">{meta(form.provider)?.blurb}</p>
        <div className="mt-3">
          <Button disabled={busy} onClick={addGateway}>Save gateway</Button>
        </div>
      </Card>

      <Card title="Send a payout">
        {payoutConfigs.length === 0 ? (
          <p className="text-sm text-muted">Add an active payout-capable gateway (e.g. Swich) to send affiliate payouts.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Gateway</label>
                <select className={INPUT} value={payout.configId} onChange={(e) => setPayout({ ...payout, configId: e.target.value })}>
                  <option value="">Select...</option>
                  {payoutConfigs.map((c) => <option key={c.id} value={c.id}>{meta(c.provider)?.name} {c.label ? '- ' + c.label : ''}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Amount</label>
                <input className={INPUT} type="number" min="0" step="0.01" value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Currency</label>
                <input className={INPUT} value={payout.currency} onChange={(e) => setPayout({ ...payout, currency: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Reference (optional)</label>
                <input className={INPUT} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Destination (JSON: bank / JazzCash / Easypaisa details)</label>
              <textarea className={INPUT + ' font-mono text-2xs'} rows={4} value={payout.destination} onChange={(e) => setPayout({ ...payout, destination: e.target.value })} />
            </div>
            <Button disabled={busy} onClick={sendPayout}>Send payout</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
