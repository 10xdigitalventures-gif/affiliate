export function StatCard({
  label,
  value,
  delta,
  positive,
}: {
  label: string
  value: string
  delta?: string
  positive?: boolean
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3 shadow-card">
      <p className="text-2xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-lg font-semibold mt-1 tabular-nums">{value}</p>
      {delta && (
        <p className={`text-2xs mt-0.5 ${positive ? 'text-success' : 'text-danger'}`}>{delta}</p>
      )}
    </div>
  )
}
