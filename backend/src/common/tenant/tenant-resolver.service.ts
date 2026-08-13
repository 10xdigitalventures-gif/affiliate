import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * A tenant hint carried by an unauthenticated request.
 *
 * `orgSlug` is supplied explicitly by the client (workspace picker on the login
 * page). `hostname` is the Host header, used for white-label login domains and
 * for `<slug>.<root-domain>` style subdomains.
 */
export type TenantHint = {
  orgSlug?: string | null
  hostname?: string | null
}

export type ResolvedTenant = {
  id: string
  slug: string
  name: string
}

/**
 * Apex domains the platform itself serves. A host of `acme.app.example.com`
 * with `TENANT_ROOT_DOMAINS=app.example.com` resolves to the org slug `acme`.
 */
const ROOT_DOMAINS = (process.env.TENANT_ROOT_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
  .filter(Boolean)

/** Subdomains that belong to the platform, never to a tenant. */
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'superadmin',
  'dashboard',
  'portal',
  'static',
  'assets',
  'cdn',
  'mail',
  'status',
  'docs',
])

/** Slugs are lowercase alphanumeric with dashes, as enforced at signup. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * Resolves which organization an unauthenticated request belongs to.
 *
 * Login, password reset and SSO must all be scoped to a single tenant: the
 * `User` table is unique on `[organizationId, email]`, not on `email` alone,
 * so an unscoped lookup can authenticate someone into the wrong workspace.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Strip port, proxy list and casing from a Host / X-Forwarded-Host value. */
  static normalizeHostname(raw?: string | null): string | null {
    if (!raw) return null
    const host = raw.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
    return host || null
  }

  static normalizeSlug(raw?: string | null): string | null {
    if (!raw) return null
    const slug = raw.trim().toLowerCase()
    return SLUG_RE.test(slug) ? slug : null
  }

  /** Extract a tenant slug from `<slug>.<root-domain>`, if configured. */
  private subdomainSlug(hostname: string): string | null {
    for (const root of ROOT_DOMAINS) {
      if (!hostname.endsWith('.' + root)) continue
      const label = hostname.slice(0, -(root.length + 1))
      if (label.includes('.')) continue // only a single leading label
      if (RESERVED_SUBDOMAINS.has(label)) continue
      return TenantResolverService.normalizeSlug(label)
    }
    return null
  }

  /**
   * Resolve the tenant for a request, in order of confidence:
   *   1. an explicit org slug chosen by the user
   *   2. a verified white-label login domain
   *   3. a `<slug>.<root-domain>` subdomain
   *
   * Returns `null` when the request carries no tenant signal; callers decide
   * whether to reject or fall back to disambiguation.
   */
  async resolve(hint: TenantHint): Promise<ResolvedTenant | null> {
    const slug = TenantResolverService.normalizeSlug(hint.orgSlug)
    if (slug) return this.bySlug(slug)

    const hostname = TenantResolverService.normalizeHostname(hint.hostname)
    if (!hostname) return null

    const byDomain = await this.byLoginDomain(hostname)
    if (byDomain) return byDomain

    const subdomain = this.subdomainSlug(hostname)
    return subdomain ? this.bySlug(subdomain) : null
  }

  async bySlug(slug: string): Promise<ResolvedTenant | null> {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true },
    })
    return org ?? null
  }

  /**
   * Only `active` login domains resolve. A pending or failed domain must never
   * select a tenant — ownership has not been proven yet.
   */
  private async byLoginDomain(hostname: string): Promise<ResolvedTenant | null> {
    const domain = await this.prisma.domain.findUnique({
      where: { hostname },
      select: {
        status: true,
        purpose: true,
        organization: { select: { id: true, slug: true, name: true } },
      },
    })
    if (!domain || domain.status !== 'active' || domain.purpose !== 'login') return null
    return domain.organization
  }
}
