import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Zero-dependency RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation plus the
 * base32 + otpauth:// helpers needed to enrol an authenticator app
 * (Google Authenticator, 1Password, Authy, etc.). No external packages so it
 * works without adding npm dependencies.
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Generate a new base32 TOTP secret (default 20 bytes = 160 bits). */
export function generateSecret(bytesLength = 20): string {
  return base32Encode(randomBytes(bytesLength))
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8)
  // 64-bit big-endian counter
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    buf[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const hmac = createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** digits).toString().padStart(digits, '0')
}

export function generateToken(base32Secret: string, atMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(atMs / 1000 / step)
  return hotp(base32Decode(base32Secret), counter, digits)
}

/**
 * Verify a submitted token against the secret, tolerating clock drift of
 * `window` steps in either direction (default +/- 1 step = 30s).
 */
export function verifyToken(
  base32Secret: string,
  token: string,
  opts: { window?: number; step?: number; digits?: number; atMs?: number } = {},
): boolean {
  const { window = 1, step = 30, digits = 6, atMs = Date.now() } = opts
  const cleaned = (token || '').replace(/\s+/g, '')
  if (!/^[0-9]{6,8}$/.test(cleaned)) return false
  const secret = base32Decode(base32Secret)
  const counter = Math.floor(atMs / 1000 / step)
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(secret, counter + w, digits)
    if (candidate.length === cleaned.length) {
      const a = Buffer.from(candidate)
      const b = Buffer.from(cleaned)
      if (a.length === b.length && timingSafeEqual(a, b)) return true
    }
  }
  return false
}

/** Build the otpauth:// URI encoded in the enrolment QR code. */
export function otpauthUrl(params: { secret: string; label: string; issuer: string }): string {
  const label = encodeURIComponent(params.label)
  const issuer = encodeURIComponent(params.issuer)
  const secret = params.secret
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}

/** Generate human-friendly one-time recovery codes (e.g. 3f2a-9b1c-...). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(6).toString('hex') // 12 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`)
  }
  return codes
}
