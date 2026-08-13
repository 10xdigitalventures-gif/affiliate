'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { SuperAdmin, Billing, BillingInvoice, GatewayConfig } from '@/lib/api'
import { useFetch, shortDate, money } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const tenant = useFetch(() => SuperAdmin.tenant(id), [id])
  const plansQ = useFetch(() => SuperAdmin.plans(), [])
  const [planId, setPlanId] = useState('')
  const [busy, setBusy] = useState(false)
  const t = tenant.data

  async function assign() {
    if (!planId) return
    setBusy(true)
    try { await SuperAdmin.assignPlan(id, { planId }); tenant.reload() } finally { setBusy(false) }
  }
  async function toggleStatus() {
    if (!t) return
    const next = t.status === 'suspended' ? 'active' : 'suspended'
    if (next === 'suspended' && !confirm(`Suspend ${t.name}?`)) return
    setBusy(true)
    try { await SuperAdmin.setStatus(id, next); tenant.reload() } finally { setBusy(false) }
  }

  if (tenant.loading) return <p className="text-sm text-muted">Loading...</p>
  if (tenant.error || !t) return <p className="text-sm text-danger">{tenant.error || 'Not found'}</p>

  const plans = (plansQ.data ?? []).filter((p) => !p.isArchived)
  const sub = t.subscription

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/admin/tenants" className="text-xs text-muted hover:text-brand">&larr; All tenants</Link>
      <div className="mt-1">
        <PageHeader title={t.name} subtitle={`${t.slug} - joined ${shortDate(t.createdAt)}`} actions={
          <Button variant={t.status === 'suspended' ? 'primary' : 'danger'} onClick={toggleStatus} disabled={busy}>
            {t.status === 'suspended' ? 'Activate tenant' : 'Suspend tenant'}
          </Button>
        } />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <StatCard label="Status" value={t.status} />
        <StatCard label="Affiliates" value={String(t._count.affiliates)} />
        <StatCard label="Stores" value={String(t._count.stores)} />
        <StatCard label="Users" value={String(t._count.users)} />
      </div>
      <div className="grid lg:grid-cols-2 gap-2">
        <Card title="Subscription">
          {sub ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted">Plan</span><span className="font-medium">{sub.plan?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Price</span><span className="tabular-nums">{money((sub.plan?.priceCents ?? 0) / 100)}/{sub.plan?.interval}</span></div>
              <div className="flex justify-between"><span className="text-muted">Status</span><StatusPill status={sub.status} /></div>
              <div className="flex justify-between"><span className="text-muted">Seats</span><span className="tabular-nums">{sub.seats}</span></div>
            </div>
          ) : (
            <p className="text-xs text-muted">No active subscription. Assign a plan below.</p>
          )}
        </Card>
        <Card title="Assign / change plan">
          <div className="flex items-center gap-1.5">
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="flex-1 rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand"
            >
              <option value="">Select a plan...</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} - {money(p.priceCents / 100)}/{p.interval}</option>
              ))}
            </select>
            <Button onClick={assign} disabled={!planId || busy}>Assign</Button>
          </div>
          <p className="mt-2 text-2xs text-muted">Assigning a plan creates or updates the tenant subscription and applies its entitlements immediately.</p>
        </Card>
      </div>
      <div className="mt-2">
        <BillingCard orgId={id} plans={plans} />
      </div>
    </div>
  )
}


function BillingCard({ orgId, plans }: { orgId: string; plans: Array<{ id: string; name: string; priceCents: number; interval: string; trialDays?: number }> }) {
  const configs = useFetch<GatewayConfig[]>(() => Billing.configs('platform'), [])
  const invoices = useFetch<BillingInvoice[]>(() => Billing.tenantInvoices(orgId), [orgId])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [planId, setPlanId] = useState('')
  const [trial, setTrial] = useState('')

  const active = (configs.data ?? []).filter((c) => c.isActive)
  const hasGateway = active.length > 0

  async function run(kind: string, fn: () => Promise<any>, ok: string) {
    setBusy(kind); setErr(null); setMsg(null)
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'url' in r && r.url) { window.open(r.url as string, '_blank'); setMsg('Opened secure card-capture page in a new tab.') }
      else if (r && typeof r === 'object' && 'setupUrl' in r && r.setupUrl) { window.open(r.setupUrl as string, '_blank'); setMsg(ok) }
      else setMsg(ok)
      invoices.reload()
    } catch (e: any) { setErr(e?.message || 'Action failed') } finally { setBusy('') }
  }

  return (
    <Card title="Billing">
      {!hasGateway ? (
        <p className="text-xs text-muted">No active payment gateway yet. Add Whop or Swich under Billing first.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" disabled={busy !== ''} onClick={() => run('setup', () => Billing.startSetup(orgId, {}), 'Card setup started.')}>
              {busy === 'setup' ? 'Opening...' : 'Save card on file'}
            </Button>
          </div>

          <div className="rounded-md border border-line p-2.5">
            <p className="text-2xs uppercase tracking-wide text-muted mb-1.5">Start subscription (applies plan trial)</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="flex-1 min-w-[10rem] rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand">
                <option value="">Select plan...</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} - {money(p.priceCents / 100)}/{p.interval}{p.trialDays ? ` - ${p.trialDays}d trial` : ''}</option>
                ))}
              </select>
              <input value={trial} onChange={(e) => setTrial(e.target.value)} placeholder="Trial days (optional)" className="w-40 rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand" />
              <Button disabled={!planId || busy !== ''} onClick={() => run('sub', () => Billing.startSubscription(orgId, { planId, trialDaysOverride: trial ? Number(trial) : undefined }), 'Subscription started with trial.')}>
                {busy === 'sub' ? 'Starting...' : 'Start'}
              </Button>
            </div>
            <p className="text-2xs text-muted mt-1">Trial days come from the plan (set in Plans) unless overridden here. Card is charged automatically when the trial ends.</p>
          </div>

          <div className="rounded-md border border-line p-2.5">
            <p className="text-2xs uppercase tracking-wide text-muted mb-1.5">One-off charge (tax added per gateway settings)</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (e.g. 49.00)" className="w-44 rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand" />
              <Button disabled={!amount || busy !== ''} onClick={() => run('charge', () => Billing.charge(orgId, { amountCents: Math.round(Number(amount) * 100), description: 'Manual charge' }), 'Charge created - invoice + receipt sent.')}>
                {busy === 'charge' ? 'Charging...' : 'Charge card'}
              </Button>
            </div>
          </div>

          {msg && <p className="text-xs text-success">{msg}</p>}
          {err && <p className="text-xs text-danger">{err}</p>}

          <div>
            <p className="text-2xs uppercase tracking-wide text-muted mb-1.5">Invoices</p>
            {invoices.loading ? (
              <p className="text-xs text-muted">Loading...</p>
            ) : !invoices.data || invoices.data.length === 0 ? (
              <p className="text-xs text-muted">No invoices yet.</p>
            ) : (
              <div className="space-y-1">
                {invoices.data.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 text-xs border-b border-line py-1 last:border-0">
                    <span className="text-muted">{shortDate(inv.createdAt)}</span>
                    <span className="flex-1 truncate">{inv.number || inv.provider}</span>
                    <span className="tabular-nums">{money(inv.totalCents / 100, inv.currency)}</span>
                    <StatusPill status={inv.status} />
                    {inv.hostedUrl && <a href={inv.hostedUrl} target="_blank" className="text-brand hover:underline">View</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
