import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
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
 *   SHOPIFY_API_VERSION    pinned supported Admin API version (required)
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
    const version = process.env.SHOPIFY_API_VERSION || ''
    if (!/^20\d{2}-(01|04|07|10)$/.test(version)) {
      throw new BadRequestException('SHOPIFY_API_VERSION must be configured as a supported YYYY-MM version')
    }
    return version
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

  // ─── One-time OAuth state (carries no tenant data in the browser) ──────────
  async signState(organizationId: string): Promise<string> {
    const state = randomBytes(32).toString('base64url')
    await this.prisma.shopifyOAuthState.create({
      data: {
        organizationId,
        stateHash: createHash('sha256').update(state).digest('hex'),
        expiresAt: new Date(Date.now() + this.stateTtlMs),
      },
    })
    this.prisma.shopifyOAuthState
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } })
      .catch(() => undefined)
    return state
  }

  async verifyState(state: string | undefined): Promise<{ organizationId: string }> {
    if (!state) throw new BadRequestException('Missing OAuth state')
    const record = await this.prisma.shopifyOAuthState.findUnique({
      where: { stateHash: createHash('sha256').update(state).digest('hex') },
    })
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired OAuth state')
    }
    const consumed = await this.prisma.shopifyOAuthState.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (consumed.count !== 1) throw new BadRequestException('OAuth state has already been used')
    return { organizationId: record.organizationId }
  }

  /** Build the Shopify authorize URL the merchant is redirected to. */
  async buildInstallUrl(shop: string, organizationId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Shopify app not configured (SHOPIFY_API_KEY / SHOPIFY_API_SECRET missing)')
    }
    const shopHost = this.normalizeShop(shop)
    const state = await this.signState(organizationId)
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
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      throw new BadRequestException(`Shopify token exchange failed (${res.status})`)
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
          signal: AbortSignal.timeout(10_000),
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
    const { organizationId } = await this.verifyState(query.state)
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
  verifySessionToken(sessionToken: string): { shop: string; shopifyUserId: string } {
    if (!this.isConfigured()) throw new BadRequestException('Shopify app not configured')
    const parts = (sessionToken || '').split('.')
    if (parts.length !== 3) throw new UnauthorizedException('Malformed session token')
    const [header, payload, signature] = parts
    const decodedHeader = (() => {
      try { return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown> }
      catch { throw new UnauthorizedException('Malformed session token header') }
    })()
    if (decodedHeader.alg !== 'HS256') throw new UnauthorizedException('Unsupported session token algorithm')
    const expected = createHmac('sha256', this.apiSecret).update(`${header}.${payload}`).digest('base64url')
    if (!this.safeEqual(signature, expected)) throw new UnauthorizedException('Invalid session token signature')
    let claims: any
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      throw new UnauthorizedException('Malformed session token payload')
    }
    const now = Math.floor(Date.now() / 1000)
    if (typeof claims.exp !== 'number' || claims.exp < now - 5 || claims.exp > now + 5 * 60) {
      throw new UnauthorizedException('Session token expiry is invalid')
    }
    if (typeof claims.nbf !== 'number' || claims.nbf > now + 5) throw new UnauthorizedException('Session token not yet valid')
    if (typeof claims.iat !== 'number' || claims.iat > now + 5) throw new UnauthorizedException('Session token issue time is invalid')
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(this.apiKey)) throw new UnauthorizedException('Session token audience mismatch')
    if (typeof claims.sub !== 'string' || !claims.sub) throw new UnauthorizedException('Session token subject is missing')
    let destination: URL
    try { destination = new URL(String(claims.dest || '')) }
    catch { throw new UnauthorizedException('Session token destination is invalid') }
    if (destination.protocol !== 'https:') throw new UnauthorizedException('Session token destination is invalid')
    return { shop: this.normalizeShop(destination.hostname), shopifyUserId: claims.sub }
  }

  /** Explicitly bind the current platform user to their Shopify staff identity. */
  async linkSessionIdentity(sessionToken: string, organizationId: string, userId: string) {
    const { shop, shopifyUserId } = this.verifySessionToken(sessionToken)
    const store = await this.prisma.store.findFirst({
      where: { organizationId, platform: 'shopify' as any, domain: shop },
    })
    if (!store) throw new UnauthorizedException('This Shopify store is not connected to your workspace')
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId, status: 'active' as any } })
    if (!user) throw new UnauthorizedException('Platform account is not active')

    const existing = await this.prisma.shopifyStaffIdentity.findUnique({
      where: { storeId_shopifyUserId: { storeId: store.id, shopifyUserId } },
    })
    if (existing && existing.userId !== userId) {
      throw new UnauthorizedException('This Shopify staff identity is already linked to another account')
    }
    return this.prisma.shopifyStaffIdentity.upsert({
      where: { storeId_userId: { storeId: store.id, userId } },
      create: { organizationId, storeId: store.id, userId, shopifyUserId },
      update: { shopifyUserId, lastSeenAt: new Date() },
      select: { id: true, storeId: true, lastSeenAt: true },
    })
  }

  /**
   * Exchange a verified Shopify session token for platform access/refresh tokens
   * scoped to the organization that owns the connected store. This powers the
   * embedded (in-admin) experience so the merchant never leaves Shopify.
   */
  async exchangeSessionForTokens(sessionToken: string) {
    const { shop, shopifyUserId } = this.verifySessionToken(sessionToken)
    const store = await this.prisma.store.findFirst({
      where: { platform: 'shopify' as any, domain: shop },
    })
    if (!store) throw new UnauthorizedException('This Shopify store is not connected to an account yet')
    const identity = await this.prisma.shopifyStaffIdentity.findUnique({
      where: { storeId_shopifyUserId: { storeId: store.id, shopifyUserId } },
      include: { user: true, organization: true },
    })
    if (!identity || identity.organizationId !== store.organizationId) {
      throw new UnauthorizedException('Shopify identity is not linked. Sign in to the platform and link this Shopify staff account.')
    }
    if (identity.user.status !== 'active' || identity.organization.status === 'suspended') {
      throw new UnauthorizedException('Linked platform account is not active')
    }
    await this.prisma.shopifyStaffIdentity.update({
      where: { id: identity.id },
      data: { lastSeenAt: new Date() },
    })
    return this.auth.issueTokensForUser(identity.userId)
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    return ab.length === bb.length && timingSafeEqual(ab, bb)
  }
}
