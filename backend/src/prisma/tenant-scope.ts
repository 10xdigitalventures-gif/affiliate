import { Logger } from '@nestjs/common'
import { getTenantContext, isUnscoped, unscopedReason } from './tenant-context'

const logger = new Logger('TenantScope')

/**
 * How each model is tied to an organization.
 *
 * - `direct`   : the table has its own `organizationId` column.
 * - `root`     : the Organization table itself; scoped on `id`.
 * - `relation` : no `organizationId` column; reached through a relation.
 * - `global`   : shared reference data with no tenant at all.
 */
export type ScopeStrategy =
  | { kind: 'direct' }
  | { kind: 'root' }
  | { kind: 'relation'; where: (organizationId: string) => Record<string, unknown> }
  | { kind: 'global' }

/**
 * Every model in the schema must appear here. `assertTenantMapComplete` fails
 * at startup if a new model is added without a decision being made, so a new
 * table can never silently default to unscoped.
 */
export const TENANT_SCOPE_MAP: Record<string, ScopeStrategy> = {
  Organization: { kind: 'root' },

  // Shared reference data - identical for every tenant.
  Permission: { kind: 'global' },
  RolePermission: { kind: 'global' },
  // Raw provider webhook envelopes; the tenant is only known after parsing.
  GatewayEvent: { kind: 'global' },
  // OAuth / SSO state tokens are short-lived and keyed by a random hash;
  // they carry organizationId for lookup but are not tenant-queryable.
  SsoLoginState: { kind: 'direct' },
  ShopifyOAuthState: { kind: 'direct' },

  // No organizationId column - scoped through a relation.
  Order: { kind: 'relation', where: (o) => ({ store: { organizationId: o } }) },
  OrderItem: { kind: 'relation', where: (o) => ({ order: { store: { organizationId: o } } }) },
  Commission: { kind: 'relation', where: (o) => ({ affiliate: { organizationId: o } }) },
  // User-scoped tokens (no organizationId; scoped via the user -> org relation).
  LoginExchangeCode: { kind: 'relation', where: (o) => ({ user: { organizationId: o } }) },
  ShopifyStaffIdentity: { kind: 'direct' },

  // Everything below carries its own organizationId column.
  Affiliate: { kind: 'direct' },
  AffiliateApplication: { kind: 'direct' },
  AffiliateLink: { kind: 'direct' },
  AffiliateLedgerEntry: { kind: 'direct' },
  AffiliateBalance: { kind: 'direct' },
  ApiKey: { kind: 'direct' },
  AuditLog: { kind: 'direct' },
  BillingCustomer: { kind: 'direct' },
  BillingInvoice: { kind: 'direct' },
  Campaign: { kind: 'direct' },
  Category: { kind: 'direct' },
  Click: { kind: 'direct' },
  CommissionAdjustment: { kind: 'direct' },
  CommissionRule: { kind: 'direct' },
  Conversion: { kind: 'direct' },
  Coupon: { kind: 'direct' },
  Customer: { kind: 'direct' },
  Domain: { kind: 'direct' },
  FraudReview: { kind: 'direct' },
  Invitation: { kind: 'direct' },
  MarketingAsset: { kind: 'direct' },
  Notification: { kind: 'direct' },
  PasswordResetToken: { kind: 'direct' },
  PaymentGatewayConfig: { kind: 'direct' },
  Payout: { kind: 'direct' },
  PayoutItem: { kind: 'direct' },
  PayoutMethodRecord: { kind: 'direct' },
  Plan: { kind: 'direct' },
  Product: { kind: 'direct' },
  ProductMapping: { kind: 'direct' },
  RefreshToken: { kind: 'direct' },
  Role: { kind: 'direct' },
  Setting: { kind: 'direct' },
  Store: { kind: 'direct' },
  StoreCredential: { kind: 'direct' },
  Subscription: { kind: 'direct' },
  SyncJob: { kind: 'direct' },
  User: { kind: 'direct' },
  UserRole: { kind: 'direct' },
  WebhookEvent: { kind: 'direct' },
}

/** Operations whose `where` should be narrowed to the tenant. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
])

/** Operations that write new rows and should carry the tenant in `data`. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'upsert'])

export type ScopeMode = 'off' | 'warn' | 'enforce'

/**
 * `warn` logs unscoped access without changing behaviour, so the remaining call
 * sites can be found from real traffic before `enforce` starts throwing.
 */
export function scopeMode(): ScopeMode {
  const raw = (process.env.TENANT_SCOPE_MODE || 'warn').toLowerCase()
  return raw === 'off' || raw === 'enforce' ? raw : 'warn'
}

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tenant-scoped query on ${model}.${operation} ran without a tenant context. ` +
        'Wrap the call in runWithTenant(), or in runUnscoped(reason) if crossing ' +
        'tenants is genuinely intended.',
    )
    this.name = 'TenantScopeError'
  }
}

/** Build the filter that restricts a model to one organization. */
export function scopeFilterFor(model: string, organizationId: string): Record<string, unknown> | null {
  const strategy = TENANT_SCOPE_MAP[model]
  if (!strategy || strategy.kind === 'global') return null
  if (strategy.kind === 'root') return { id: organizationId }
  if (strategy.kind === 'relation') return strategy.where(organizationId)
  return { organizationId }
}

/**
 * Fails at startup if the schema contains a model this map does not classify.
 * Prevents a newly added table from quietly escaping tenant scoping.
 */
export function assertTenantMapComplete(modelNames: string[]): void {
  const missing = modelNames.filter((m) => !TENANT_SCOPE_MAP[m])
  if (missing.length) {
    throw new Error(
      `TENANT_SCOPE_MAP is missing ${missing.length} model(s): ${missing.join(', ')}. ` +
        'Add each one as direct, relation, root or global in src/prisma/tenant-scope.ts.',
    )
  }
  const stale = Object.keys(TENANT_SCOPE_MAP).filter((m) => !modelNames.includes(m))
  if (stale.length) logger.warn(`TENANT_SCOPE_MAP lists models no longer in the schema: ${stale.join(', ')}`)
}

/**
 * `warn` logs unscoped access without changing behaviour, so the remaining call
 * sites can be found from real traffic before `enforce` starts throwing.
 *
 * Limitations worth knowing:
 * - `$queryRaw` / `$executeRaw` bypass this entirely. Raw SQL must filter by
 *   organization itself.
 * - `create` on a relation-scoped model (Order, OrderItem, Commission) cannot
 *   be auto-scoped, because the tenant lives on a parent row. Those creates
 *   rely on the caller passing an already-scoped storeId / orderId /
 *   affiliateId. Adding an organizationId column to those three tables would
 *   close the gap and is also a prerequisite for database-level RLS.
 */
export function applyTenantScope(model: string, operation: string, args: any): any {
  if (scopeMode() === 'off') return args

  const strategy = TENANT_SCOPE_MAP[model]
  // Unknown or shared model: nothing to scope.
  if (!strategy || strategy.kind === 'global') return args

  if (isUnscoped()) {
    logger.debug(`Unscoped ${model}.${operation}: ${unscopedReason()}`)
    return args
  }

  const ctx = getTenantContext()
  if (!ctx) {
    if (scopeMode() === 'enforce') throw new TenantScopeError(model, operation)
    logger.warn(
      `${model}.${operation} ran with no tenant context and was NOT scoped. ` +
        'Wrap it in runWithTenant() or runUnscoped(reason) before switching ' +
        'TENANT_SCOPE_MODE to enforce.',
    )
    return args
  }

  // Super admins legitimately read across tenants; that access is audited
  // separately rather than blocked here.
  if (ctx.isSuperAdmin) return args

  const filter = scopeFilterFor(model, ctx.organizationId)
  if (!filter) return args

  const next = { ...(args ?? {}) }

  if (WHERE_OPERATIONS.has(operation)) {
    // Prisma ANDs top-level where keys, so spreading the filter narrows the
    // caller's conditions instead of replacing them. Applying it last also
    // means a caller cannot widen scope by passing their own organizationId.
    next.where = { ...(next.where ?? {}), ...filter }
  }

  if (CREATE_OPERATIONS.has(operation) && strategy.kind === 'direct') {
    if (operation === 'createMany') {
      const rows = Array.isArray(next.data) ? next.data : [next.data]
      next.data = rows.map((row: any) => ({ ...row, ...filter }))
    } else if (operation === 'upsert') {
      next.create = { ...(next.create ?? {}), ...filter }
    } else {
      next.data = { ...(next.data ?? {}), ...filter }
    }
  }

  return next
}

/**
 * Prisma middleware form, applied with `client.$use()`.
 *
 * Deliberately chosen over a `$extends` client extension: `$extends` returns a
 * NEW client instance, so all ~429 existing `this.prisma.<model>` call sites
 * would have had to be repointed at it to gain any protection - and any missed
 * one would silently stay unscoped. `$use` mutates the instance the app already
 * injects, so every existing call site is covered with no edits.
 */
export function tenantScopeMiddleware() {
  return async (params: any, next: (p: any) => Promise<any>) => {
    if (!params.model) return next(params) // raw / $-level operations
    return next({ ...params, args: applyTenantScope(params.model, params.action, params.args) })
  }
}

/**
 * Client-extension form, kept ready for when the codebase migrates off the
 * deprecated `$use` API. Not wired up yet - see the note on
 * `tenantScopeMiddleware` for why.
 */
export function tenantScopeExtension() {
  return {
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          return query(applyTenantScope(model, operation, args))
        },
      },
    },
  }
}
