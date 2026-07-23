'use client'
import { useState } from 'react'
import { SuperAdmin, FEATURE_CATALOG, LIMIT_CATALOG, type AdminPlan, type CreatePlanInput } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type Draft = {
  id?: string
  key: string
  name: string
  description: string
  priceDollars: number
  currency: string
  interval: 'month' | 'year'
  trialDays: number
  features: Record<string, boolean>
  limits: Record<string, number>
  isPublic: boolean
}

function emptyDraft(): Draft {
  return {
    key: '', name: '', description: '', priceDollars: 0, currency: 'USD', interval: 'month', trialDays: 14,
    features: Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, false])),
    limits: Object.fromEntries(LIMIT_CATALOG.map((l) => [l.key, 0])),
    isPublic: true,
  }
}

function toDraft(p: AdminPlan): Draft {
  const missingLimitDefaults: Record<string, number> = {
    trackingLinksPerAffiliate: 5,
    monthlyPayoutRequestsPerAffiliate: 1,
  }
  return {
    id: p.id, key: p.key, name: p.name, description: p.description ?? '',
    priceDollars: Math.round(p.priceCents / 100), currency: p.currency, interval: p.interval, trialDays: p.trialDays,
    features: { ...Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, false])), ...p.features },
    limits: { ...Object.fromEntries(LIMIT_CATALOG.map((l) => [l.key, missingLimitDefaults[l.key] ?? 0])), ...p.limits },
    isPublic: p.isPublic,
  }
}

export default function PlansPage() {
  const { data, loading, reload } = useFetch(() => SuperAdmin.plans(), [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!draft) return
    setBusy(true); setErr(null)
    const payload: CreatePlanInput = {
      key: draft.key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      priceCents: Math.round(draft.priceDollars * 100),
      currency: draft.currency,
      interval: draft.interval,
      trialDays: draft.trialDays,
      features: draft.features,
      limits: draft.limits,
      isPublic: draft.isPublic,
    }
    try {
      if (draft.id) {
        const { key, ...rest } = payload
        await SuperAdmin.updatePlan(draft.id, rest)
      } else {
        await SuperAdmin.createPlan(payload)
      }
      setDraft(null)
      reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: AdminPlan) {
    if (!confirm(`Delete plan "${p.name}"? If it has subscribers it will be archived instead.`)) return
    await SuperAdmin.deletePlan(p.id)
    reload()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Plans" subtitle="Packages tenants can subscribe to" actions={
        <Button onClick={() => { setErr(null); setDraft(emptyDraft()) }}><Plus size={13} /> New plan</Button>
      } />

      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    {p.isArchived ? <StatusPill status="archived" /> : p.isPublic ? <StatusPill status="active" /> : <span className="text-2xs text-muted">hidden</span>}
                  </div>
                  <p className="text-2xs text-muted">{p.key}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => { setErr(null); setDraft(toDraft(p)) }}><Pencil size={13} /></Button>
                  <Button variant="ghost" onClick={() => remove(p)}><Trash2 size={13} /></Button>
                </div>
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums">{money(p.priceCents / 100, p.currency)}<span className="text-xs font-normal text-muted">/{p.interval}</span></p>
              {p.description && <p className="mt-1 text-xs text-muted">{p.description}</p>}
              <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-2xs text-muted">
                {LIMIT_CATALOG.map((limit) => (
                  <div key={limit.key} className="flex justify-between gap-2"><span>{limit.label}</span><strong className="font-medium text-ink">{p.limits[limit.key] === -1 ? 'Unlimited' : p.limits[limit.key] ?? 0}</strong></div>
                ))}
              </div>
              <p className="mt-2 text-2xs text-muted">{FEATURE_CATALOG.filter((feature) => p.features[feature.key]).length} of {FEATURE_CATALOG.length} optional features enabled</p>
              <p className="mt-2 text-2xs text-muted">{p.trialDays} trial day(s) · {p._count?.subscriptions ?? 0} subscriber(s)</p>
            </Card>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/30 p-4" onClick={() => setDraft(null)}>
          <div className="mt-8 w-full max-w-lg rounded-lg border border-line bg-white shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <h2 className="text-sm font-medium">{draft.id ? 'Edit plan' : 'New plan'}</h2>
              <button onClick={() => setDraft(null)} className="text-muted hover:text-ink text-sm">Close</button>
            </div>
            <div className="space-y-3 p-3">
              {err && <p className="rounded bg-danger/10 px-2 py-1 text-xs text-danger">{err}</p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-2xs uppercase tracking-wide text-muted">Key</span>
                  <input disabled={!!draft.id} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                    placeholder="growth" className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand disabled:bg-gray-50" />
                </label>
                <label className="block">
                  <span className="text-2xs uppercase tracking-wide text-muted">Name</span>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Growth" className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand" />
                </label>
              </div>
              <label className="block">
                <span className="text-2xs uppercase tracking-wide text-muted">Description</span>
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand" />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-2xs uppercase tracking-wide text-muted">Price</span>
                  <input type="number" min={0} value={draft.priceDollars} onChange={(e) => setDraft({ ...draft, priceDollars: Number(e.target.value) })}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand" />
                </label>
                <label className="block">
                  <span className="text-2xs uppercase tracking-wide text-muted">Currency</span>
                  <input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand" />
                </label>
                <label className="block">
                  <span className="text-2xs uppercase tracking-wide text-muted">Interval</span>
                  <select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value as 'month' | 'year' })}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand">
                    <option value="month">month</option>
                    <option value="year">year</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-2xs uppercase tracking-wide text-muted">Free trial days</span>
                <input type="number" min={0} max={365} value={draft.trialDays}
                  onChange={(e) => setDraft({ ...draft, trialDays: Math.max(0, Math.min(365, Number(e.target.value))) })}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand" />
              </label>
              <div>
                <span className="text-2xs uppercase tracking-wide text-muted">Limits (-1 = unlimited)</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {LIMIT_CATALOG.map((l) => (
                    <label key={l.key} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
                      <span className="text-xs">{l.label}</span>
                      <input type="number" value={draft.limits[l.key]} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [l.key]: Number(e.target.value) } })}
                        className="w-16 rounded border border-line px-1.5 py-0.5 text-xs text-right outline-none focus:border-brand" />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-2xs uppercase tracking-wide text-muted">Features</span>
                <div className="mt-1 grid grid-cols-1 gap-1">
                  {FEATURE_CATALOG.map((f) => (
                    <label key={f.key} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={!!draft.features[f.key]} onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [f.key]: e.target.checked } })} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} />
                Show on public pricing page
              </label>
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t border-line px-3 py-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} disabled={busy || !draft.key || !draft.name}>{busy ? 'Saving...' : 'Save plan'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
