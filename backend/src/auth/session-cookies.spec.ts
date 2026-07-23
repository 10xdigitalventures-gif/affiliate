import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  setEmbeddedSessionCookies,
  setSessionCookies,
} from './session-cookies'

describe('session cookies', () => {
  const previousEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...previousEnv, NODE_ENV: 'production', API_PREFIX: 'v1' }
    delete process.env.COOKIE_DOMAIN
  })

  afterAll(() => {
    process.env = previousEnv
  })

  it('uses host-only Secure HttpOnly cookies and narrows the refresh path', () => {
    const response = { cookie: jest.fn() } as any

    setSessionCookies(response, { access_token: 'access', refresh_token: 'refresh' })

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      ACCESS_COOKIE,
      'access',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    )
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      REFRESH_COOKIE,
      'refresh',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/v1/auth' }),
    )
    expect(response.cookie.mock.calls[0][2]).not.toHaveProperty('domain')
  })

  it('uses CHIPS-compatible cookies for a Shopify iframe and expires both variants', () => {
    const response = { cookie: jest.fn(), clearCookie: jest.fn() } as any

    setEmbeddedSessionCookies(response, { access_token: 'access', refresh_token: 'refresh' })
    clearSessionCookies(response)

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      ACCESS_COOKIE,
      'access',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        partitioned: true,
        path: '/',
      }),
    )
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      REFRESH_COOKIE,
      'refresh',
      expect.objectContaining({ partitioned: true, path: '/v1/auth' }),
    )
    expect(response.clearCookie).toHaveBeenCalledTimes(4)
    expect(response.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      expect.objectContaining({ partitioned: true, sameSite: 'none', path: '/v1/auth' }),
    )
  })
})
