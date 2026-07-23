'use client'
import { useState } from 'react'
import Link from 'next/link'
import { SuperAdmin } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, type Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'
import { Button } from '@/components/ui/button'
import type { AdminTenant } from '@/lib/api'
import { LIMIT_CATALOG, FEATURE_CATALOG } from '@/lib/api'
import { Plus } from 'lucide-react'

type TenantDraft = {
  name: string
  slug: string
  ownerName: string
  ownerEmail: string
  planId: string
  defaultCurrency: string
  status: 'active' | 'trial'
}

const emptyTenant = (): TenantDraft => ({
  name: '', slug: '', ownerName: '', ownerEmail: '', planId: '', defaultCurrency: 'USD', status: 'trial',
})

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

export default function TenantsPage() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, loading, reload } = useFetch(() => SuperAdmin.tenants(q || undefined), [q])
  const plansQ = useFetch(() => SuperAdmin.plans(), [])
  const [draft, setDraft] = useState<TenantDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function createTenant() {
    if (!draft) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const result = await SuperAdmin.createTenant({
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        ownerName: draft.ownerName.trim() || undefined,
        ownerEmail: draft.ownerEmail.trim().toLowerCase(),
        planId: draft.planId || undefined,
        defaultCurrency: draft.defaultCurrency,
        status: draft.status,
        sendLoginCode: true,
      })
      setDraft(null)
      setSuccess(result.loginCodeSent
        ? `Organization created. Login code sent to ${result.owner.email}.`
        : `Organization created. ${result.loginCodeWarning || `The owner can request a login code at the sign-in page using workspace ${result.slug}.`}`)
      reload()
    } catch (err) {
      setError((err as Error).message || 'Organization could not be created')
    } finally { setBusy(false) }
  }

  async function toggleStatus(t: AdminTenant) {
    const next = t.status === 'suspended' ? 'active' : 'suspended'
    if (next === 'suspended' && !confirm(`Suspend ${t.name}? Their users will lose access.`)) return
    await SuperAdmin.setStatus(t.id, next)
    reload()
  }

  const columns: Column<AdminTenant>[] = [
    { key: 'name', header: 'Tenant', render: (t) => (
      <Link href={`/admin/tenants/${t.id}`} className="font-medium text-brand hover:underline">{t.name}</Link>
    ) },
    { key: 'slug', header: 'Slug', render: (t) => <span className="text-muted">{t.slug}</span> },
    { key: 'plan', header: 'Plan', render: (t) => t.plan ? t.plan.name : <span className="text-muted">-</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill status={t.status} /> },
    { key: 'affiliates', header: 'Affiliates', align: 'right', render: (t) => t.counts.affiliates },
    { key: 'stores', header: 'Stores', align: 'right', render: (t) => t.counts.stores },
    { key: 'users', header: 'Users', align: 'right', render: (t) => t.counts.users },
    { key: 'createdAt', header: 'Joined', render: (t) => shortDate(t.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (t) => (
      <Button variant={t.status === 'suspended' ? 'outline' : 'danger'} onClick={() => toggleStatus(t)}>
        {t.status === 'suspended' ? 'Activate' : 'Suspend'}
      </Button>
    ) },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Organizations" subtitle="Create workspaces, assign plans and control usage" actions={
        <div className="flex items-center gap-1.5">
        <form onSubmit={(e) => { e.preventDefault(); setQ(search) }} className="flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug"
            className="rounded-md border border-line px-2.5 py-1 text-xs outline-none focus:border-brand"
          />
          <Button variant="outline" type="submit">Search</Button>
        </form>
        <Button onClick={() => { setError(null); setSuccess(null); setDraft(emptyTenant()) }}><Plus size={13} /> New organization</Button>
        </div>
      } />
      {success && <p className="mb-2 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success">{success}</p>}
      <DataTable columns={columns} rows={data ?? []} loading={loading} empty="No tenants found" />

      {draft && (() => {
        const selectedPlan = (plansQ.data ?? []).find((plan) => plan.id === draft.planId)
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/30 p-4" onClick={() => setDraft(null)}>
            <div className="mt-8 w-full max-w-xl rounded-lg border border-line bg-white shadow-lift" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <div><h2 className="text-sm font-semibold">New organization</h2><p className="text-2xs text-muted">The owner will sign in using the code sent to their email.</p></div>
                <button onClick={() => setDraft(null)} className="text-xs text-muted hover:text-ink">Close</button>
              </div>
              <div className="space-y-3 p-3">
                {error && <p className="rounded bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block"><span className="text-2xs uppercase text-muted">Organization name</span><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value, slug: slugify(e.target.value) })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" placeholder="Acme Partners" /></label>
                  <label className="block"><span className="text-2xs uppercase text-muted">Workspace ID</span><input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" placeholder="acme-partners" /></label>
                  <label className="block"><span className="text-2xs uppercase text-muted">Owner name</span><input value={draft.ownerName} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" placeholder="Account owner" /></label>
                  <label className="block"><span className="text-2xs uppercase text-muted">Owner email</span><input type="email" value={draft.ownerEmail} onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" placeholder="owner@example.com" /></label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="block sm:col-span-2"><span className="text-2xs uppercase text-muted">Plan (optional)</span><select value={draft.planId} onChange={(e) => setDraft({ ...draft, planId: e.target.value })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"><option value="">No paid plan / fallback limits</option>{(plansQ.data ?? []).filter((plan) => !plan.isArchived).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} — {(plan.priceCents / 100).toFixed(2)} {plan.currency}/{plan.interval}</option>)}</select></label>
                  <label className="block"><span className="text-2xs uppercase text-muted">Status</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as 'active' | 'trial' })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"><option value="trial">Trial</option><option value="active">Active</option></select></label>
                </div>
                <label className="block max-w-32"><span className="text-2xs uppercase text-muted">Currency</span><input value={draft.defaultCurrency} maxLength={3} onChange={(e) => setDraft({ ...draft, defaultCurrency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className="mt-0.5 w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" /></label>
                {selectedPlan && <div className="rounded-md border border-line bg-gray-50 p-2.5"><p className="text-xs font-medium">{selectedPlan.name} includes</p><div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-muted">{LIMIT_CATALOG.map((limit) => <span key={limit.key}>{limit.label}: <strong className="text-ink">{selectedPlan.limits[limit.key] === -1 ? 'Unlimited' : selectedPlan.limits[limit.key] ?? 0}</strong></span>)}</div><p className="mt-2 text-2xs text-muted">{FEATURE_CATALOG.filter((feature) => selectedPlan.features[feature.key]).map((feature) => feature.label).join(' · ') || 'No optional features'}</p></div>}
              </div>
              <div className="flex justify-end gap-1.5 border-t border-line px-3 py-2"><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button disabled={busy || !draft.name.trim() || draft.slug.length < 2 || !draft.ownerEmail.includes('@')} onClick={createTenant}>{busy ? 'Creating…' : 'Create & email login code'}</Button></div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
