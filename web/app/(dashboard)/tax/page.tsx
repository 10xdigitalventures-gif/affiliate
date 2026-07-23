'use client'
import { useState } from 'react'
import { Tax } from '@/lib/api'
import type { TaxReportRow } from '@/lib/api'
import { useFetch, money } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusPill } from '@/components/ui/status-pill'

export default function TaxReportPage() {
  const now = new Date().getUTCFullYear()
  const [year, setYear] = useState(now)
  const report = useFetch(() => Tax.report(year), [year])

  const columns: Column<TaxReportRow>[] = [
    { key: 'affiliateCode', header: 'Affiliate', render: (r) => <span className="font-medium">{r.affiliateCode}</span> },
    { key: 'name', header: 'Legal name', render: (r) => r.name ?? <span className="text-muted">-</span> },
    { key: 'country', header: 'Country', render: (r) => r.country ?? '-' },
    { key: 'formType', header: 'Form', render: (r) => r.formType ? r.formType.toUpperCase() : <span className="text-danger text-2xs">missing</span> },
    { key: 'formStatus', header: 'Status', render: (r) => <StatusPill status={r.formStatus} /> },
    { key: 'tinLast4', header: 'TIN', render: (r) => r.tinLast4 ? `***-**-${r.tinLast4}` : '-' },
    { key: 'totalPaid', header: 'Paid this year', align: 'right', render: (r) => money(r.totalPaid) },
    { key: 'needs1099', header: '1099-NEC', render: (r) => r.needs1099 ? <span className="text-2xs rounded-full bg-brand/10 text-brand px-2 py-0.5">Required</span> : <span className="text-2xs text-muted">-</span> },
  ]

  const years = [now, now - 1, now - 2, now - 3]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Tax & 1099 reporting" subtitle="Year-end summary of affiliate payouts and W-9 / W-8BEN status" />
      <div className="grid sm:grid-cols-4 gap-2 mb-3">
        <Card title="Tax year">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full rounded-md border border-line px-2 py-1.5 text-sm">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Card>
        <Card title="Reportable (1099-NEC)"><p className="text-2xl font-semibold">{report.data?.totalReportable ?? 0}</p></Card>
        <Card title="Missing forms"><p className="text-2xl font-semibold text-danger">{report.data?.missingForms ?? 0}</p></Card>
        <Card title="Threshold"><p className="text-2xl font-semibold">{money(report.data?.threshold ?? 600)}</p></Card>
      </div>
      <DataTable columns={columns} rows={report.data?.rows ?? []} loading={report.loading} empty="No paid affiliates in this year" />
    </div>
  )
}
