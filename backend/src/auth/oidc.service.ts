import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'crypto'
import { assertSafeOutboundUrl, safeFetch, safeFetchJson } from '../common/security/outbound-http'

type JsonObject = Record<string, unknown>

export type OidcConfiguration = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri: string
  token_endpoint_auth_methods_supported?: string[]
}

export type VerifiedIdentity = {
  subject: string
  email: string
  name: string | null
}

function decodeJsonSegment(segment: string): JsonObject {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as JsonObject
  } catch {
    throw new UnauthorizedException('Identity provider returned an invalid ID token')
  }
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/$/, '')
}

@Injectable()
export class OidcService {
  private readonly discoveryCache = new Map<string, { expiresAt: number; value: OidcConfiguration }>()
  private readonly jwksCache = new Map<string, { expiresAt: number; keys: JsonObject[] }>()

  async discover(issuerUrl: string): Promise<OidcConfiguration> {
    const issuer = normalizeIssuer(issuerUrl)
    const cached = this.discoveryCache.get(issuer)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const value = await safeFetchJson<OidcConfiguration>(
      `${issuer}/.well-known/openid-configuration`,
      { headers: { accept: 'application/json' } },
    )
    if (
      normalizeIssuer(value.issuer || '') !== issuer ||
      !value.authorization_endpoint ||
      !value.token_endpoint ||
      !value.jwks_uri
    ) {
      throw new BadRequestException('OIDC discovery document is incomplete or has the wrong issuer')
    }

    // Validate every endpoint now. Fetches later are still checked immediately
    // before use, which also protects against DNS changes and stale config.
    await Promise.all([
      safeFetchEndpointOnly(value.authorization_endpoint),
      safeFetchEndpointOnly(value.token_endpoint),
      safeFetchEndpointOnly(value.jwks_uri),
      ...(value.userinfo_endpoint ? [safeFetchEndpointOnly(value.userinfo_endpoint)] : []),
    ])
    this.discoveryCache.set(issuer, { expiresAt: Date.now() + 10 * 60_000, value })
    return value
  }

  async exchangeCode(input: {
    configuration: OidcConfiguration
    clientId: string
    clientSecret: string
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<JsonObject> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
    })
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    }
    const methods = input.configuration.token_endpoint_auth_methods_supported ?? ['client_secret_post']
    if (input.clientSecret && methods.includes('client_secret_basic')) {
      headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`
    } else if (input.clientSecret) {
      body.set('client_secret', input.clientSecret)
    }

    const response = await safeFetch(input.configuration.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    })
    if (!response.ok) throw new UnauthorizedException('SSO token exchange failed')
    const contentType = response.headers.get('content-type') || ''
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (!contentType.toLowerCase().includes('application/json') || declaredLength > 1_048_576) {
      throw new UnauthorizedException('SSO token endpoint returned an invalid response')
    }
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
      throw new UnauthorizedException('SSO token endpoint response is too large')
    }
    try { return JSON.parse(text) as JsonObject }
    catch { throw new UnauthorizedException('SSO token endpoint returned invalid JSON') }
  }

  async resolveIdentity(input: {
    configuration: OidcConfiguration
    tokenJson: JsonObject
    clientId: string
    nonce: string
  }): Promise<VerifiedIdentity> {
    const idToken = input.tokenJson.id_token
    if (typeof idToken !== 'string') throw new UnauthorizedException('Identity provider did not return an ID token')
    const claims = await this.verifyIdToken(idToken, input.configuration, input.clientId, input.nonce)

    let email = typeof claims.email === 'string' ? claims.email : ''
    let name = typeof claims.name === 'string' ? claims.name : null
    if (!email && input.configuration.userinfo_endpoint && typeof input.tokenJson.access_token === 'string') {
      const ui = await safeFetchJson<JsonObject>(input.configuration.userinfo_endpoint, {
        headers: { authorization: `Bearer ${input.tokenJson.access_token}`, accept: 'application/json' },
      })
      if (ui.sub !== claims.sub) throw new UnauthorizedException('OIDC userinfo subject did not match the ID token')
      email = typeof ui.email === 'string' ? ui.email : ''
      name = typeof ui.name === 'string' ? ui.name : name
      if (ui.email_verified === false) throw new UnauthorizedException('SSO email address is not verified')
    }
    if (!email || claims.email_verified === false) {
      throw new UnauthorizedException('SSO provider did not supply a verified email address')
    }
    return { subject: claims.sub as string, email, name }
  }

  private async verifyIdToken(
    token: string,
    configuration: OidcConfiguration,
    clientId: string,
    nonce: string,
  ): Promise<JsonObject> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new UnauthorizedException('Identity provider returned an invalid ID token')
    const header = decodeJsonSegment(parts[0])
    const claims = decodeJsonSegment(parts[1])
    const alg = typeof header.alg === 'string' ? header.alg : ''
    const kid = typeof header.kid === 'string' ? header.kid : ''
    const algorithmMap: Record<string, string> = {
      RS256: 'RSA-SHA256',
      RS384: 'RSA-SHA384',
      RS512: 'RSA-SHA512',
    }
    if (!kid || !algorithmMap[alg]) throw new UnauthorizedException('Unsupported ID-token signature algorithm')

    const keys = await this.getJwks(configuration.jwks_uri)
    const jwk = keys.find((key) => key.kid === kid && (!key.alg || key.alg === alg))
    if (!jwk) {
      this.jwksCache.delete(configuration.jwks_uri)
      const refreshed = await this.getJwks(configuration.jwks_uri)
      const retry = refreshed.find((key) => key.kid === kid && (!key.alg || key.alg === alg))
      if (!retry) throw new UnauthorizedException('Identity provider signing key was not found')
      return this.verifyWithKey(parts, claims, retry, algorithmMap[alg], configuration, clientId, nonce)
    }
    return this.verifyWithKey(parts, claims, jwk, algorithmMap[alg], configuration, clientId, nonce)
  }

  private verifyWithKey(
    parts: string[],
    claims: JsonObject,
    jwk: JsonObject,
    algorithm: string,
    configuration: OidcConfiguration,
    clientId: string,
    nonce: string,
  ): JsonObject {
    let key
    try {
      key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })
    } catch {
      throw new UnauthorizedException('Identity provider signing key is invalid')
    }
    const verified = verifySignature(
      algorithm,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], 'base64url'),
    )
    if (!verified) throw new UnauthorizedException('ID-token signature verification failed')

    const now = Math.floor(Date.now() / 1000)
    const issuer = typeof claims.iss === 'string' ? normalizeIssuer(claims.iss) : ''
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (issuer !== normalizeIssuer(configuration.issuer)) throw new UnauthorizedException('ID-token issuer mismatch')
    if (!audience.includes(clientId)) throw new UnauthorizedException('ID-token audience mismatch')
    if (audience.length > 1 && claims.azp !== clientId) throw new UnauthorizedException('ID-token authorized party mismatch')
    if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new UnauthorizedException('ID token has expired')
    if (typeof claims.iat !== 'number' || claims.iat > now + 60) throw new UnauthorizedException('ID token issue time is invalid')
    if (claims.nonce !== nonce) throw new UnauthorizedException('ID-token nonce mismatch')
    if (typeof claims.sub !== 'string' || !claims.sub) throw new UnauthorizedException('ID token has no subject')
    return claims
  }

  private async getJwks(jwksUri: string): Promise<JsonObject[]> {
    const cached = this.jwksCache.get(jwksUri)
    if (cached && cached.expiresAt > Date.now()) return cached.keys
    const body = await safeFetchJson<{ keys?: JsonObject[] }>(jwksUri, { headers: { accept: 'application/json' } })
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new UnauthorizedException('Identity provider did not publish signing keys')
    }
    this.jwksCache.set(jwksUri, { expiresAt: Date.now() + 10 * 60_000, keys: body.keys })
    return body.keys
  }
}

async function safeFetchEndpointOnly(raw: string) {
  // URL and DNS validation without performing an HTTP request.
  await assertSafeOutboundUrl(raw)
}
