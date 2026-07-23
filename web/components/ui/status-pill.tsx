const MAP: Record<string, string> = {
  active: 'bg-success/10 text-success',
  approved: 'bg-success/10 text-success',
  payable: 'bg-success/10 text-success',
  paid: 'bg-success/10 text-success',
  connected: 'bg-success/10 text-success',
  healthy: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  processing: 'bg-warning/10 text-warning',
  locked: 'bg-brand/10 text-brand',
  reversed: 'bg-danger/10 text-danger',
  cancelled: 'bg-danger/10 text-danger',
  error: 'bg-danger/10 text-danger',
  rejected: 'bg-danger/10 text-danger',
}

export function StatusPill({ status }: { status: string }) {
  const cls = MAP[status?.toLowerCase()] || 'bg-gray-100 text-muted'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  )
}
