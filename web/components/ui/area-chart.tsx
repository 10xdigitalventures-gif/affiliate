'use client'
import type { TimePoint } from '@/lib/api'

// Dependency-free inline SVG area chart: revenue (brand) vs commissions (green).
export function AreaChart({ data, height = 160 }: { data: TimePoint[]; height?: number }) {
  if (!data || data.length === 0) {
    return <div className="h-40 grid place-items-center text-xs text-muted">No data yet</div>
  }
  const w = 640
  const h = height
  const pad = 6
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.commissions)))
  const n = data.length
  const x = (i: number) => pad + (i / (n - 1 || 1)) * (w - 2 * pad)
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad)
  const line = (key: 'revenue' | 'commissions') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const area = (key: 'revenue' | 'commissions') =>
    `${line(key)} L${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)} L${x(0).toFixed(1)},${(h - pad).toFixed(1)} Z`

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" height={h} preserveAspectRatio="none">
        <path d={area('revenue')} fill="#1B4DFF" opacity={0.08} />
        <path d={line('revenue')} fill="none" stroke="#1B4DFF" strokeWidth={1.5} />
        <path d={line('commissions')} fill="none" stroke="#16A34A" strokeWidth={1.5} />
      </svg>
      <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted">
        <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-brand inline-block" />Revenue</span>
        <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-success inline-block" />Commissions</span>
      </div>
    </div>
  )
}
