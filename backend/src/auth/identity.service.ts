import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { runUnscoped } from '../prisma/tenant-context'

/**
 * The trusted identity for a request, rebuilt from the database rather than
 * read out of the JWT. Anything security-relevant (organization, permissions,
 * super-admin flag) must come from here.
 */
export type AuthIdentity = {
  sub: string
  organizationId: string
  permissions: string[]
  affiliateId: string | null
  isSuperAdmin: boolean
}

type CacheEntry = { identity: AuthIdentity | null; expiresAt: number }

/** 0 disables caching entirely (every request re-reads the database). */
function cacheTtlMs(): number {
  const raw = Number(process.env.AUTH_IDENTITY_CACHE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 5_000
}

/**
 * Resolves a user id into a verified identity.
 *
 * A JWT is only proof that *we* issued it, not that its contents are still
 * true. A user can be suspended, have roles revoked, or have their whole
 * organization suspended while a valid access token is still in circulation.
 * So the token is used for one thing only - the subject id - and every other
 * claim is recomputed here.
 *
 * A short TTL cache keeps this from becoming a database read on all ~287
 * authenticated call sites per request. The TTL bounds how long a revoked
 * permission can still be honoured; set AUTH_IDENTITY_CACHE_MS=0 for
 * strict-but-slower behaviour.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name)
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string): Promise<AuthIdentity | null> {
    const ttl = cacheTtlMs()
    const now = Date.now()

    if (ttl > 0) {
      const hit = this.cache.get(userId)
      if (hit && hit.expiresAt > now) return hit.identity
    }

    const identity = await this.load(userId)

    if (ttl > 0) {
      this.cache.set(userId, { identity, expiresAt: now + ttl })
      // The cache is per-process and bounded only by distinct active users, so
      // sweep expired entries opportunistically to avoid unbounded growth.
      if (this.cache.size > 5_000) this.sweep(now)
    }

    return identity
  }

  /** Drop a cached identity immediately, e.g. after a role or status change. */
  invalidate(userId: string): void {
    this.cache.delete(userId)
  }

  /** Drop every cached identity. Used by tests and by bulk permission changes. */
  invalidateAll(): void {
    this.cache.clear()
  }

  private async load(userId: string): Promise<AuthIdentity | null> {
    // Authentication runs before a tenant context exists - it is what produces
    // one - and the lookup is by primary key, not by tenant.
    const user = await runUnscoped('auth: verify JWT subject against the database', () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          organizationId: true,
          isSuperAdmin: true,
          organization: { select: { status: true } },
          affiliate: { select: { id: true } },
          roles: {
            select: {
              role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
            },
          },
        },
      }),
    )

    if (!user) return null

    // Deleted-then-recreated ids aside, these are the states where a still-valid
    // token must stop working immediately.
    if (user.status !== 'active') {
      this.logger.debug(`Rejected token for user ${userId}: status is ${user.status}`)
      return null
    }
    if (user.organization?.status === 'suspended') {
      this.logger.debug(`Rejected token for user ${userId}: organization is suspended`)
      return null
    }

    // A user can hold the same permission through more than one role.
    const permissionKeys: string[] = user.roles.flatMap((ur) =>
      ur.role.permissions.map((rp) => rp.permission.key),
    )
    const permissions = Array.from(new Set<string>(permissionKeys))

    return {
      sub: user.id,
      organizationId: user.organizationId,
      permissions,
      affiliateId: user.affiliate?.id ?? null,
      isSuperAdmin: user.isSuperAdmin ?? false,
    }
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key)
    }
  }
}
