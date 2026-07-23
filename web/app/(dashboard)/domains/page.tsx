'use client'
import { useState } from 'react'
import { Domains, type CustomDomain, type DomainPurpose } from '@/lib/api'
import { useFetch } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'

const INPUT = 'w-full rounded-md border border-line px-2.5 py-1.5 text-sm'
const LABEL = 'block text-2xs font-medium text-muted mb-1'
const MONO = 'font-mono text-2xs bg-surface rounded px-1.5 py-0.5 break-all'

const PURPOSE_LABEL: Record<DomainPurpose, string> = {
  login: 'White-label portal',
  tracking: 'First-party tracking',
}

export default function DomainsPage() {
  const { data, loading, refresh } = useFetch(() => Domains.list(), [])
  const track = useFetch(() => Domains.trackingBase(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ hostname: '', purpose: 'tracking' as DomainPurpose })

  const domains = data ?? []

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setNotice(null)
    try { await fn(); setNotice(ok); refresh(); track.refresh() }
    catch (e: any) { setError(e?.message || 'Something went wrong') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Domains"
        subtitle="Connect your own domains for a white-label affiliate portal and first-party click tracking that survives Safari ITP and ad-blockers."
      />

      {error && <div className="rounded-md bg-red-50 text-danger text-sm px-3 py-2">{error}</div>}
      {notice && <div className="rounded-md bg-green-50 text-success text-sm px-3 py-2">{notice}</div>}

      <Card title="Effective tracking base">
        {track.loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm">
              Affiliate links are currently generated from{' '}
              <span className={MONO}>{track.data?.baseUrl}</span>
            </p>
            <p className="text-2xs text-muted">
              {track.data?.custom
                ? 'Using your verified first-party tracking domain — clicks are counted first-party.'
                : 'Using the shared platform domain. Add and verify a tracking domain below to serve clicks first-party.'}
            </p>
          </div>
        )}
      </Card>

      <Card title="Add a domain">
        <div className="grid gap-3 sm:grid-cols-[1fr,220px,auto] sm:items-end">
          <div>
            <label className={LABEL}>Hostname</label>
            <input
              className={INPUT}
              placeholder="go.yourbrand.com"
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            />
          </div>
          <div>
            <label className={LABEL}>Purpose</label>
            <select
              className={INPUT}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value as DomainPurpose })}
            >
              <option value="tracking">First-party tracking</option>
              <option value="login">White-label portal</option>
            </select>
          </div>
          <Button
            disabled={busy || !form.hostname.trim()}
            onClick={() =>
              run(async () => {
                await Domains.add(form.hostname.trim().toLowerCase(), form.purpose)
                setForm({ hostname: '', purpose: form.purpose })
              }, 'Domain added — add the DNS records below, then verify.')
            }
          >
            Add domain
          </Button>
        </div>
        <p className="text-2xs text-muted mt-2">
          Tip: use a subdomain of your store (e.g. <span className={MONO}>go.yourbrand.com</span>) for tracking so
          cookies stay first-party.
        </p>
      </Card>

      {loading ? (
        <p className="text-sm text-muted">Loading domains…</p>
      ) : domains.length === 0 ? (
        <Card><p className="text-sm text-muted">No domains yet.</p></Card>
      ) : (
        domains.map((d) => <DomainRow key={d.id} domain={d} busy={busy} run={run} />)
      )}
    </div>
  )
}

function DomainRow({
  domain,
  busy,
  run,
}: {
  domain: CustomDomain
  busy: boolean
  run: (fn: () => Promise<unknown>, ok: string) => void
}) {
  const i = domain.instructions
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{domain.hostname}</span>
          <span className="text-2xs rounded bg-surface px-1.5 py-0.5 text-muted">{PURPOSE_LABEL[domain.purpose]}</span>
          {domain.isPrimary && <span className="text-2xs rounded bg-brand/10 px-1.5 py-0.5 text-brand">Primary</span>}
          <StatusPill status={domain.status} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => Domains.verify(domain.id), 'Verification checked.')}>
            Verify
          </Button>
          {domain.status === 'active' && !domain.isPrimary && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => run(() => Domains.setPrimary(domain.id), 'Set as primary.')}>
              Make primary
            </Button>
          )}
          <Button size="sm" variant="danger" disabled={busy}
            onClick={() => run(() => Domains.remove(domain.id), 'Domain removed.')}>
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-2xs font-medium text-muted">Add these DNS records at your registrar:</p>
        <div className="rounded-md border border-line divide-y divide-line text-2xs">
          <div className="grid grid-cols-[64px,1fr] gap-2 px-2.5 py-1.5">
            <span className="text-muted">CNAME</span>
            <span><span className={MONO}>{i.cname.host}</span> &rarr; <span className={MONO}>{i.cname.target}</span></span>
          </div>
          <div className="grid grid-cols-[64px,1fr] gap-2 px-2.5 py-1.5">
            <span className="text-muted">TXT</span>
            <span><span className={MONO}>{i.txt.host}</span> = <span className={MONO}>{i.txt.value}</span></span>
          </div>
        </div>

        {domain.purpose === 'tracking' && (
          <div className="pt-1">
            <p className="text-2xs font-medium text-muted mb-1">Store snippet (serves clicks first-party):</p>
            <pre className="bg-surface rounded-md p-2 text-2xs overflow-x-auto">{`<script src="https://${domain.hostname}/track.js"\n        data-api="https://${domain.hostname}/v1"\n        data-org="${domain.organizationId}"></script>`}</pre>
          </div>
        )}
      </div>
    </Card>
  )
}
