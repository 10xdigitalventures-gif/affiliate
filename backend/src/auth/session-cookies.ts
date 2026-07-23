import type { Request, Response } from 'express'

export const ACCESS_COOKIE = 'affiliate_access'
export const REFRESH_COOKIE = 'affiliate_refresh'

export type SessionTokens = {
  access_token: string
  refresh_token: string
}

export function readCookie(req: Pick<Request, 'headers'> | any, name: string): string | undefined {
  const raw = typeof req.headers?.cookie === 'string' ? req.headers.cookie : ''
  for (const item of raw.split(';')) {
    const [key, ...value] = item.trim().split('=')
    if (key !== name) continue
    try {
      return decodeURIComponent(value.join('='))
    } catch {
      return undefined
    }
  }
  return undefined
}

function cookieOptions(
  maxAge: number,
  path = '/',
  embedded = false,
) {
  return {
    httpOnly: true,
    // SameSite=None cookies are only accepted when Secure. The embedded flow
    // always runs through Shopify + HTTPS, including when a developer has not
    // set NODE_ENV yet.
    secure: embedded || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    sameSite: embedded ? ('none' as const) : ('lax' as const),
    path,
    maxAge,
    // CHIPS keeps the Shopify iframe session isolated per top-level shop/admin
    // site instead of creating a general third-party cookie.
    ...(embedded ? { partitioned: true } : {}),
    ...(!embedded && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  }
}

function refreshPath() {
  const prefix = (process.env.API_PREFIX || 'v1').replace(/^\/+|\/+$/g, '')
  return `/${prefix}/auth`
}

export function setSessionCookies(res: Response, tokens: SessionTokens) {
  res.cookie(ACCESS_COOKIE, tokens.access_token, cookieOptions((Number(process.env.JWT_ACCESS_TTL) || 900) * 1000))
  res.cookie(
    REFRESH_COOKIE,
    tokens.refresh_token,
    cookieOptions((Number(process.env.JWT_REFRESH_TTL) || 604800) * 1000, refreshPath()),
  )
}

/** HttpOnly, partitioned cookies for the cross-site Shopify admin iframe. */
export function setEmbeddedSessionCookies(res: Response, tokens: SessionTokens) {
  res.cookie(
    ACCESS_COOKIE,
    tokens.access_token,
    cookieOptions((Number(process.env.JWT_ACCESS_TTL) || 900) * 1000, '/', true),
  )
  res.cookie(
    REFRESH_COOKIE,
    tokens.refresh_token,
    cookieOptions((Number(process.env.JWT_REFRESH_TTL) || 604800) * 1000, refreshPath(), true),
  )
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(0))
  res.clearCookie(REFRESH_COOKIE, cookieOptions(0, refreshPath()))
  // Also expire the partitioned variants when logout is called from Shopify.
  res.clearCookie(ACCESS_COOKIE, cookieOptions(0, '/', true))
  res.clearCookie(REFRESH_COOKIE, cookieOptions(0, refreshPath(), true))
}
