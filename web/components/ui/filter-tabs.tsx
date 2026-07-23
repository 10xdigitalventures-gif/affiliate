'use client'

export function FilterTabs({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-0.5 text-xs transition cursor-pointer ${
            value === o.value ? 'bg-surface text-brand font-medium' : 'text-muted hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
