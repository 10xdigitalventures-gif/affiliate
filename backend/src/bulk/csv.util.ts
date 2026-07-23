/** Minimal, dependency-free CSV helpers (RFC-4180-ish). */

export function buildCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = String(v ?? '')
    // Spreadsheet applications execute cells beginning with =, +, - or @.
    // Neutralize user-controlled formula payloads while preserving ordinary
    // numeric values (including legitimate negative amounts) as numbers.
    if (
      typeof v === 'string' &&
      /^\s*[=+\-@]/.test(s) &&
      !/^\s*[+\-]?\d+(?:\.\d+)?\s*$/.test(s)
    ) {
      s = `'${s}`
    }
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

/**
 * Parse CSV text into an array of row objects keyed by the header row.
 * Handles quoted fields, escaped quotes (""), and commas/newlines inside quotes.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  // flush last field/row (ignore a trailing empty line)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length === 0) return []
  const header = nonEmpty[0].map((h) => h.trim())
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
    return obj
  })
}
