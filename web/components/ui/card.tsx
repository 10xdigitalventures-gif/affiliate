export function Card({
  title,
  children,
  actions,
  className = '',
}: {
  title?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-line bg-white shadow-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line">
          <h2 className="text-sm font-medium">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  )
}
