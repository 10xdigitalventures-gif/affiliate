'use client'
import { useState } from 'react'
import { Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  Billing,
  GATEWAY_CATALOG,
  GatewayConfig,
  GatewayProviderKey,
  UpsertGatewayConfigInput,
} from '@/lib/api'
import { useFetch } from '@/lib/use-fetch'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/status-pill'

type FormState = UpsertGatewayConfigInput & { id?: string }

const EMPTY: FormState = {
  provider: 'whop',
  scope: 'platform',
  label: '',
  companyId: '',
  apiKey: '',
  webhookSecret: '',
  isLive: false,
  isActive: true,
  isDefault: false,
  taxEnabled: false,
  taxPercent: 0,
  taxLabel: 'Tax',
  taxInclusive: false,
}

export default function BillingPage() {
  const { data, loading, error, reload } = useFetch(() => Billing.configs('platform'), [])
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const openNew = () => { setErr(null); setForm({ ...EMPTY }) }
  const openEdit = (c: GatewayConfig) => {
    setErr(null)
    setForm({
      id: c.id, provider: c.provider, scope: c.scope, label: c.label ?? '', companyId: c.companyId ?? '',
      apiKey: '', webhookSecret: '', isLive: c.isLive, isActive: c.isActive, isDefault: c.isDefault,
      taxEnabled: c.taxEnabled, taxPercent: c.taxPercent, taxLabel: c.taxLabel ?? 'Tax', taxInclusive: c.taxInclusive,
    })
  }

  const save = async () => {
    if (!form) return
    setBusy(true); setErr(null)
    try {
      const { id, ...dto } = form
      if (id && !dto.apiKey) delete dto.apiKey
      if (id && !dto.webhookSecret) delete dto.webhookSecret
      if (id) await Billing.updateConfig(id, dto)
      else await Billing.createConfig(dto)
      setForm(null)
      reload()
    } catch (e: any) {
      setErr(e?.message || 'Could not save gateway')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (c: GatewayConfig) => {
    if (!confirm(`Remove ${c.provider} gateway${c.label ? ` \u201c${c.label}\u201d` : ''}?`)) return
    await Billing.deleteConfig(c.id)
    reload()
  }

  const copy = async (url: string, id: string) => {
    try { await navigator.clipboard.writeText(url) } catch {}
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
  }

  const catalogFor = (k: GatewayProviderKey) => GATEWAY_CATALOG.find((g) => g.key === k)!

  return (
    <div>
      <PageHeader
        title="Billing & payment gateways"
        subtitle="Charge your clients like Stripe \u2014 saved cards, invoices, receipts, taxes on top, trials from the plan, and payouts."
        actions={<Button onClick={openNew}><Plus size={13} /> Add gateway</Button>}
      />

      <div className="grid gap-2 sm:grid-cols-2 mb-4">
        {GATEWAY_CATALOG.map((g) => (
          <div key={g.key} className="rounded-lg border border-line bg-white p-3 shadow-card">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{g.name}</span>
              <span className="text-2xs rounded bg-surface text-brand px-1.5 py-0.5">{g.region}</span>
              {g.supportsPayouts && <span className="text-2xs rounded bg-gray-100 text-muted px-1.5 py-0.5">Payouts</span>}
            </div>
            <p className="text-xs text-muted mt-1">{g.blurb}</p>
            <p className="text-2xs text-muted mt-1.5">Needs: {g.credentials.join(' \u00b7 ')}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      <Card title="Configured gateways">
        {loading ? (
          <p className="text-xs text-muted">Loading\u2026</p>
        ) : !data || data.length === 0 ? (
          <p className="text-xs text-muted">No gateways yet. Click \u201cAdd gateway\u201d to connect Whop or Swich.</p>
        ) : (
          <div className="space-y-2">
            {data.map((c) => (
              <div key={c.id} className="rounded-md border border-line p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm">{catalogFor(c.provider).name}</span>
                      {c.label && <span className="text-xs text-muted">{c.label}</span>}
                      <StatusPill status={c.isLive ? 'active' : 'pending'} />
                      <span className="text-2xs text-muted">{c.isLive ? 'Live' : 'Test'}</span>
                      {c.isDefault && <span className="text-2xs rounded bg-brand/10 text-brand px-1.5 py-0.5">Default</span>}
                      {!c.isActive && <span className="text-2xs rounded bg-gray-100 text-muted px-1.5 py-0.5">Disabled</span>}
                    </div>
                    <p className="text-2xs text-muted mt-1">
                      Company ID: {c.companyId || '\u2014'} \u00b7 API key {c.hasApiKey ? 'set' : 'missing'} \u00b7 Webhook secret {c.hasWebhookSecret ? 'set' : 'missing'}
                      {c.taxEnabled ? ` \u00b7 Tax +${c.taxPercent}% (${c.taxInclusive ? 'inclusive' : 'on top of client'})` : ' \u00b7 No tax'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" onClick={() => openEdit(c)}><Pencil size={12} /> Edit</Button>
                    <Button variant="danger" onClick={() => remove(c)}><Trash2 size={12} /></Button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded bg-surface px-2 py-1">
                  <span className="text-2xs text-muted shrink-0">Webhook URL</span>
                  <code className="text-2xs text-ink truncate flex-1">{c.webhookUrl}</code>
                  <button
                    onClick={() => copy(c.webhookUrl, c.id)}
                    className="inline-flex items-center gap-1 text-2xs text-brand hover:underline cursor-pointer shrink-0"
                  >
                    {copied === c.id ? <Check size={12} /> : <Copy size={12} />} {copied === c.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-2xs text-muted mt-1">
                  Add this URL as a webhook in the {catalogFor(c.provider).name} dashboard, then paste its signing secret above.
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {form && (
        <GatewayForm
          form={form}
          setForm={setForm}
          onClose={() => setForm(null)}
          onSave={save}
          busy={busy}
          err={err}
        />
      )}
    </div>
  )
}

function GatewayForm({
  form, setForm, onClose, onSave, busy, err,
}: {
  form: FormState
  setForm: (f: FormState) => void
  onClose: () => void
  onSave: () => void
  busy: boolean
  err: string | null
}) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch })
  const cat = GATEWAY_CATALOG.find((g) => g.key === form.provider)!
  const editing = !!form.id
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-lg bg-white shadow-lift mt-8">
        <div className="flex items-center justify-between px-3 py-2 border-b border-line">
          <h2 className="text-sm font-medium">{editing ? 'Edit gateway' : 'Add gateway'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-2.5">
          <div>
            <label className="text-2xs uppercase tracking-wide text-muted">Provider</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {GATEWAY_CATALOG.map((g) => (
                <button
                  key={g.key}
                  disabled={editing}
                  onClick={() => set({ provider: g.key })}
                  className={`rounded-md border px-2 py-1.5 text-xs text-left transition cursor-pointer disabled:opacity-60 ${
                    form.provider === g.key ? 'border-brand bg-surface text-brand' : 'border-line hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium block">{g.name}</span>
                  <span className="text-2xs text-muted">{g.region}</span>
                </button>
              ))}
            </div>
            <p className="text-2xs text-muted mt-1">{cat.blurb}</p>
          </div>

          <Field label="Label (optional)">
            <input className="inp" value={form.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Primary" />
          </Field>
          <Field label="Company ID">
            <input className="inp" value={form.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value })} placeholder={form.provider === 'whop' ? 'biz_...' : 'Merchant ID'} />
          </Field>
          <Field label={editing ? 'API key (leave blank to keep)' : 'API key'}>
            <input className="inp" type="password" value={form.apiKey ?? ''} onChange={(e) => set({ apiKey: e.target.value })} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022" />
          </Field>
          <Field label={editing ? 'Webhook secret (leave blank to keep)' : 'Webhook secret'}>
            <input className="inp" type="password" value={form.webhookSecret ?? ''} onChange={(e) => set({ webhookSecret: e.target.value })} placeholder={form.provider === 'whop' ? 'whsec_...' : '\u2022\u2022\u2022\u2022\u2022\u2022'} />
          </Field>
          {editing ? (
            <p className="text-2xs text-muted">Save first to generate the webhook URL, then add it in the {cat.name} dashboard.</p>
          ) : (
            <p className="text-2xs text-muted">After saving, a webhook URL is generated \u2014 add it in the {cat.name} dashboard and paste back its signing secret.</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Toggle label="Live mode" checked={!!form.isLive} onChange={(v) => set({ isLive: v })} />
            <Toggle label="Active" checked={!!form.isActive} onChange={(v) => set({ isActive: v })} />
            <Toggle label="Default" checked={!!form.isDefault} onChange={(v) => set({ isDefault: v })} />
          </div>

          <div className="rounded-md border border-line p-2.5 space-y-2">
            <Toggle label="Charge tax on top of the client" checked={!!form.taxEnabled} onChange={(v) => set({ taxEnabled: v })} />
            {form.taxEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tax %">
                  <input className="inp" type="number" min={0} max={100} step="0.01" value={form.taxPercent ?? 0} onChange={(e) => set({ taxPercent: Number(e.target.value) })} />
                </Field>
                <Field label="Tax label">
                  <input className="inp" value={form.taxLabel ?? 'Tax'} onChange={(e) => set({ taxLabel: e.target.value })} placeholder="GST / VAT / Sales tax" />
                </Field>
                <div className="col-span-2">
                  <Toggle label="Price already includes tax (inclusive)" checked={!!form.taxInclusive} onChange={(v) => set({ taxInclusive: v })} />
                </div>
              </div>
            )}
            <p className="text-2xs text-muted">When on top, tax is added as an extra line item so the client pays it \u2014 shown at document/plan creation.</p>
          </div>

          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-line">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={busy}>{busy ? 'Saving\u2026' : editing ? 'Save changes' : 'Add gateway'}</Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-2xs uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand" />
      <span className="text-xs">{label}</span>
    </label>
  )
}
