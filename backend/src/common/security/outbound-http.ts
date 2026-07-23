import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { promises as dns } from 'dns'
import { isIP } from 'net'

const REQUEST_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.OUTBOUND_HTTP_TIMEOUT_MS) || 8_000, 1_000),
  30_000,
)
const MAX_JSON_BYTES = 1_048_576

function isUnsafeIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  )
}

function isUnsafeIp(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) return isUnsafeIpv4(normalized)
  if (isIP(normalized) !== 6) return true
  if (normalized.startsWith('::ffff:')) return isUnsafeIpv4(normalized.slice(7))
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  )
}

/**
 * Validate an operator/tenant controlled outbound URL before it reaches fetch.
 * Redirects are disabled separately so a public URL cannot bounce to metadata
 * or another private address after this check.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BadRequestException('Invalid outbound URL')
  }

  const allowPrivate = process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_OUTBOUND === 'true'
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new BadRequestException('Outbound URLs must use HTTPS')
  }
  if (url.username || url.password) throw new BadRequestException('Outbound URLs cannot contain credentials')
  if (!url.hostname) throw new BadRequestException('Outbound URL hostname is required')

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => [])
  if (!addresses.length) throw new BadRequestException('Outbound hostname could not be resolved')
  if (!allowPrivate && addresses.some(({ address }) => isUnsafeIp(address))) {
    throw new BadRequestException('Outbound URL resolves to a private or reserved network')
  }
  return url
}

export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const url = await assertSafeOutboundUrl(raw)
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new ServiceUnavailableException('External identity provider is unavailable')
  }
  return response
}

export async function safeFetchJson<T>(raw: string, init: RequestInit = {}): Promise<T> {
  const response = await safeFetch(raw, init)
  if (!response.ok) throw new ServiceUnavailableException('External identity provider request failed')
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ServiceUnavailableException('External identity provider returned an invalid response')
  }
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new ServiceUnavailableException('External identity provider response is too large')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new ServiceUnavailableException('External identity provider response is too large')
  }
  try { return JSON.parse(text) as T }
  catch { throw new ServiceUnavailableException('External identity provider returned invalid JSON') }
}
