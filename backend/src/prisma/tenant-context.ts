import { AsyncLocalStorage } from 'async_hooks'

/**
 * Per-request tenant context.
 *
 * Held in AsyncLocalStorage rather than on a request-scoped provider so that
 * the Prisma extension can read it from anywhere - including BullMQ workers and
 * nested service calls that never see the HTTP request object.
 */
export type TenantContext = {
  organizationId: string
  /** Set for super-admin sessions; lets audited cross-tenant reads through. */
  isSuperAdmin?: boolean
}

type Store =
  | { kind: 'tenant'; ctx: TenantContext }
  /** Deliberate cross-tenant access. `reason` shows up in logs and audits. */
  | { kind: 'unscoped'; reason: string }

const storage = new AsyncLocalStorage<Store>()

/** Run `fn` with every Prisma query scoped to one organization. */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run({ kind: 'tenant', ctx }, fn)
}

/**
 * Run `fn` with tenant scoping switched off.
 *
 * This is the ONLY sanctioned way to touch data across tenants. Every call site
 * must pass a reason describing why it is legitimate, e.g. 'login: resolve
 * account before tenant is known' or 'cron: expire trials across all orgs'.
 * Keep the wrapped block as small as possible.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  return storage.run({ kind: 'unscoped', reason }, fn)
}

/** The active tenant, or undefined when unscoped or outside any context. */
export function getTenantContext(): TenantContext | undefined {
  const store = storage.getStore()
  return store?.kind === 'tenant' ? store.ctx : undefined
}

/** True when the caller explicitly opted out of scoping via runUnscoped(). */
export function isUnscoped(): boolean {
  return storage.getStore()?.kind === 'unscoped'
}

/** The reason given to runUnscoped(), for logging. */
export function unscopedReason(): string | undefined {
  const store = storage.getStore()
  return store?.kind === 'unscoped' ? store.reason : undefined
}

/**
 * The current organization, or a thrown error if there is none.
 * Use in service code that must not run without a tenant.
 */
export function requireOrganizationId(): string {
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context: this code path requires an organization')
  return ctx.organizationId
}
