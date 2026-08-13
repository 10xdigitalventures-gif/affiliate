import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { StoresService } from '../stores/stores.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'

/**
 * ShopifyAppService — implements the full Shopify **public app** OAuth install
 * flow so a merchant can connect their store in one click (no manual token).
 *
 * Env:
 *   SHOPIFY_API_KEY        public app client id
 *   SHOPIFY_API_SECRET     app shared secret (also used to sign inbound webhooks)
 *   SHOPIFY_SCOPES         csv, default read_orders,read_products,read_discounts
 *   SHOPIFY_APP_URL        public base URL of THIS api (e.g. https://api.acme.com)
 *   SHOPIFY_API_VERSION    admin API version (default 2024-01)
 *   API_PREFIX             global route prefix (default v1)
 *
 * Inbound order/refund webhooks reuse the existing /webhooks/shopify/:storeId
 * endpoint. App-registered webhooks are HMAC-signed with the app secret, so we
 * persist SHOPIFY_API_SECRET as the store's webhookSecret.
 */
@Injectable()
export class ShopifyAppService {
  private readonly logger = new Logger('ShopifyApp')
  private readonly stateTtlMs = 15 * 60 * 1000

  constructor(
    private readonly stores: StoresService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  get apiKey() {
    return process.env.SHOPIFY_API_KEY || ''
  }
  get apiSecret() {
    return process.env.SHOPIFY_API_SECRET || ''
  }
  get scopes() {
    return process.env.SHOPIFY_SCOPES || 'read_orders,read_products,read_discounts'
  }
  get apiVersion() {
    return process.env.SHOPIFY_API_VERSION || '2024-01'
  }
  get appUrl() {
    return (process.env.SHOPIFY_APP_URL || 'http://localhost:4000').replace(/\/$/, '')
  }
  get apiPrefix() {
    return process.env.API_PREFIX || 'v1'
  }
  get dashboardUrl() {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.apiSecret
  }

  /** Validate a shop domain is a genuine *.myshopify.com host. */
  normalizeShop(shop: string | undefined): string {
    const s = (shop || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
      throw new BadRequestException('Invalid shop domain (expected <name>.myshopify.com)')
    }
    return s
  }

  private redirectUri(): string {
    return `${this.appUrl}/${this.apiPrefix}/shopify/callback`
  }

  // ─── Signed state (carries organizationId across the OAuth round-trip) ──────
  signState(organizationId: string): string {
    const body = `${organizationId}.${Date.now()}.${randomBytes(8).toString('hex')}`
    const sig = createHmac('sha256', this.apiSecret).update(body).digest('hex')
    return Buffer.from(`${body}.${sig}`).toString('base64url')
  }

  verifyState(state: string | undefined): { organizationId: string } {
    if (!state) throw new BadRequestException('Missing OAuth state')
    let decoded: string
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8')
    } catch {
      throw new BadRequestException('Malformed OAuth state')
    }
    const parts = decoded.split('.')
    if (parts.length !== 4) throw new BadRequestException('Malformed OAuth state')
    const [organizationId, ts, nonce, sig] = parts
    const expected = createHmac('sha256', this.apiSecret)
      .update(`${organizationId}.${ts}.${nonce}`)
      .digest('hex')
    if (!this.safeEqual(sig, expected)) throw new BadRequestException('OAuth state signature mismatch')
    if (Date.now() - Number(ts) > this.stateTtlMs) throw new BadRequestException('OAuth state expired')
    return { organizationId }
  }

  /** Build the Shopify authorize URL the merchant is redirected to. */
  buildInstallUrl(shop: string, organizationId: string): string {
    if (!this.isConfigured()) {
      throw new BadRequestException('Shopify app not configured (SHOPIFY_API_KEY / SHOPIFY_API_SECRET missing)')
    }
    const shopHost = this.normalizeShop(shop)
    const state = this.signState(organizationId)
    const params = new URLSearchParams({
      client_id: this.apiKey,
      scope: this.scopes,
      redirect_uri: this.redirectUri(),
      state,
      'grant_options[]': '',
    })
    return `https://${shopHost}/admin/oauth/authorize?${params.toString()}`
  }

  /** Verify the HMAC on an OAuth callback query (hex digest over sorted params). */
  verifyOAuthHmac(query: Record<string, any>): boolean {
    const { hmac, signature, ...rest } = query
    if (!hmac) return false
    const message = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
      .join('&')
    const digest = createHmac('sha256', this.apiSecret).update(message).digest('hex')
    return this.safeEqual(digest, String(hmac))
  }

  /** Exchange the temporary code for a permanent Admin API access token. */
  private async exchangeToken(shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: this.apiKey, client_secret: this.apiSecret, code }),
    })
    if (!res.ok) {
      throw new BadRequestException(`Shopify token exchange failed: ${res.status} ${await res.text()}`)
    }
    const json: any = await res.json()
    return { accessToken: json.access_token, scope: json.scope ?? '' }
  }

  /** Register the order/refund/uninstall webhooks that drive commissions. */
  private async registerWebhooks(shop: string, accessToken: string, storeId: string): Promise<string[]> {
    const address = `${this.appUrl}/${this.apiPrefix}/webhooks/shopify/${storeId}`
    const topics = ['orders/create', 'orders/updated', 'orders/paid', 'refunds/create', 'app/uninstalled']
    const registered: string[] = []
    for (const topic of topics) {
      try {
        const res = await fetch(`https://${shop}/admin/api/${this.apiVersion}/webhooks.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
        })
        if (res.ok) {
          registered.push(topic)
        } else {
          this.logger.warn(`Webhook ${topic} registration returned ${res.status}: ${await res.text()}`)
        }
      } catch (err: any) {
        this.logger.warn(`Webhook ${topic} registration error: ${err?.message}`)
      }
    }
    return registered
  }

  /**
   * Complete the OAuth callback: verify -> exchange token -> upsert store ->
   * register webhooks. Returns the connected store and the dashboard redirect.
   */
  async handleCallback(query: Record<string, any>): Promise<{ storeId: string; redirectUrl: string; webhooks: string[] }> {
    if (!this.isConfigured()) throw new BadRequestException('Shopify app not configured')
    const shop = this.normalizeShop(query.shop)
    if (!this.verifyOAuthHmac(query)) throw new BadRequestException('Invalid OAuth HMAC')
    const { organizationId } = this.verifyState(query.state)
    if (!query.code) throw new BadRequestException('Missing authorization code')

    const { accessToken, scope } = await this.exchangeToken(shop, String(query.code))

    const store = await this.stores.upsertConnected(organizationId, {
      platform: 'shopify',
      name: shop.replace('.myshopify.com', ''),
      domain: shop,
      accessToken,
      // Inbound webhooks from an app are signed with the app secret.
      webhookSecret: this.apiSecret,
      scopes: scope ? scope.split(',') : this.scopes.split(','),
    })

    const webhooks = await this.registerWebhooks(shop, accessToken, store.id)

    return {
      storeId: store.id,
      redirectUrl: `${this.dashboardUrl}/stores?connected=shopify`,
      webhooks,
    }
  }

  // ─── Embedded app: Shopify session token -> platform JWT (token exchange) ───
  /**
   * Verify a Shopify App Bridge session token (a JWT, HS256-signed with the app
   * secret) and return the shop domain from its `dest` claim.
   */
  verifySessionToken(sessionToken: string): { shop: string } {
    if (!this.isConfigured()) throw new BadRequestException('Shopify app not configured')
    const parts = (sessionToken || '').split('.')
    if (parts.length !== 3) throw new UnauthorizedException('Malformed session token')
    const [header, payload, signature] = parts
    const expected = createHmac('sha256', this.apiSecret).update(`${header}.${payload}`).digest('base64url')
    if (!this.safeEqual(signature, expected)) throw new UnauthorizedException('Invalid session token signature')
    let claims: any
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      throw new UnauthorizedException('Malformed session token payload')
    }
    const now = Math.floor(Date.now() / 1000)
    if (typeof claims.exp === 'number' && claims.exp < now) throw new UnauthorizedException('Session token expired')
    if (typeof claims.nbf === 'number' && claims.nbf > now + 5) throw new UnauthorizedException('Session token not yet valid')
    if (this.apiKey && claims.aud && claims.aud !== this.apiKey) throw new UnauthorizedException('Session token audience mismatch')
    const dest = String(claims.dest || claims.iss || '')
    const withoutProto = dest.includes('://') ? dest.slice(dest.indexOf('://') + 3) : dest
    const shop = withoutProto.split('/')[0]
    return { shop: this.normalizeShop(shop) }
  }

  /**
   * Exchange a verified Shopify session token for platform access/refresh tokens
   * scoped to the organization that owns the connected store. This powers the
   * embedded (in-admin) experience so the merchant never leaves Shopify.
   */
  async exchangeSessionForTokens(sessionToken: string) {
    const { shop } = this.verifySessionToken(sessionToken)
    const store = await this.prisma.store.findFirst({
      where: { platform: 'shopify' as any, domain: shop },
    })
    if (!store) throw new UnauthorizedException('This Shopify store is not connected to an account yet')
    const user = await this.prisma.user.findFirst({
      where: { organizationId: store.organizationId, status: 'active' as any },
      orderBy: { createdAt: 'asc' },
    })
    if (!user) throw new UnauthorizedException('No active user found for this store organization')
    return this.auth.issueTokensForUser(user.id)
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    return ab.length === bb.length && timingSafeEqual(ab, bb)
  }
}
