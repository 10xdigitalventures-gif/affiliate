import { ReactNode } from 'react'

export type Column<T> = {
  key: string
  header: string
  align?: 'left' | 'right'
  render?: (row: T) => ReactNode
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  empty = 'No records',
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  empty?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-gray-50/60 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-1.5 font-medium text-2xs uppercase tracking-wide text-muted ${
                  c.align === 'right' ? 'text-right' : ''
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted text-xs">
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted text-xs">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-line/70 last:border-0 hover:bg-gray-50/50">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
