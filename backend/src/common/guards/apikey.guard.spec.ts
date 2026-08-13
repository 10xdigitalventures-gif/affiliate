import { UnauthorizedException } from '@nestjs/common'
import { ApiKeyGuard } from './apikey.guard'

/**
 * Regression cover for C3: the guard used to accept `?apiKey=`, which leaks a
 * long-lived credential into access logs, browser history and Referer headers.
 * The header is now the only accepted transport.
 */
function makeCtx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any
}

function makeGuard(verify = jest.fn(async () => ({
  id: 'key1',
  organizationId: 'org1',
  scopes: ['orders.write'],
}))) {
  const apiKeys: any = { verify }
  return { guard: new ApiKeyGuard(apiKeys), verify }
}

describe('ApiKeyGuard (regression: C3)', () => {
  it('authenticates a key sent in the x-api-key header', async () => {
    const { guard, verify } = makeGuard()
    const req: any = { headers: { 'x-api-key': 'aff_live_abc' }, query: {} }

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true)

    expect(verify).toHaveBeenCalledWith('aff_live_abc')
    expect(req.user).toMatchObject({
      organizationId: 'org1',
      apiKeyId: 'key1',
      scopes: ['orders.write'],
      permissions: ['orders.write'],
      sub: 'apikey:key1',
    })
  })

  it('rejects a key sent in the query string and never verifies it', async () => {
    const { guard, verify } = makeGuard()
    const req = { headers: {}, query: { apiKey: 'aff_live_abc' }, method: 'POST', path: '/v1/orders' }

    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects the snake_case query variant too', async () => {
    const { guard, verify } = makeGuard()
    const req = { headers: {}, query: { api_key: 'aff_live_abc' }, method: 'POST', path: '/v1/orders' }

    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(verify).not.toHaveBeenCalled()
  })

  it('tells a query-string caller to move to the header and rotate the key', async () => {
    const { guard } = makeGuard()
    const req = { headers: {}, query: { apiKey: 'aff_live_abc' }, method: 'POST', path: '/v1/orders' }

    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(/x-api-key header/i)
    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(/revoke/i)
  })

  it('ignores a query key even when a valid header is also present', async () => {
    const { guard, verify } = makeGuard()
    const req = {
      headers: { 'x-api-key': 'aff_live_header' },
      query: { apiKey: 'aff_live_query' },
    }

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith('aff_live_header')
    expect(verify).not.toHaveBeenCalledWith('aff_live_query')
  })

  it('requires a key when none is supplied at all', async () => {
    const { guard, verify } = makeGuard()

    await expect(guard.canActivate(makeCtx({ headers: {}, query: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(verify).not.toHaveBeenCalled()
  })

  it('treats a blank or whitespace-only header as missing', async () => {
    const { guard, verify } = makeGuard()

    await expect(
      guard.canActivate(makeCtx({ headers: { 'x-api-key': '   ' }, query: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(verify).not.toHaveBeenCalled()
  })

  it('uses the first value when the header is repeated', async () => {
    const { guard, verify } = makeGuard()
    const req = { headers: { 'x-api-key': ['aff_live_first', 'aff_live_second'] }, query: {} }

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith('aff_live_first')
  })

  it('propagates rejection of an invalid key', async () => {
    const verify = jest.fn(async () => {
      throw new UnauthorizedException('Invalid API key')
    })
    const { guard } = makeGuard(verify as any)

    await expect(
      guard.canActivate(makeCtx({ headers: { 'x-api-key': 'aff_live_bad' }, query: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
