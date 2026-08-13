import { buildCsv, parseCsv } from './csv.util'

describe('csv.util', () => {
  it('builds CSV and escapes commas, quotes and newlines', () => {
    const csv = buildCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['line1\nline2', 1]])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('a,b')
    expect(lines[1]).toBe('"x,y","he said ""hi"""')
    // newline field is quoted, so it spans two physical lines
    expect(csv).toContain('"line1\nline2",1')
  })

  it('round-trips build -> parse', () => {
    const csv = buildCsv(['affiliateCode', 'referralSlug', 'status'], [['SUMMER10', 'summer10', 'approved']])
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ affiliateCode: 'SUMMER10', referralSlug: 'summer10', status: 'approved' })
  })

  it('parses quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Doe, Jane","said ""hi"""')
    expect(rows[0].name).toBe('Doe, Jane')
    expect(rows[0].note).toBe('said "hi"')
  })

  it('handles CRLF line endings and skips blank lines', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ a: '1', b: '2' })
    expect(rows[1]).toEqual({ a: '3', b: '4' })
  })

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})
