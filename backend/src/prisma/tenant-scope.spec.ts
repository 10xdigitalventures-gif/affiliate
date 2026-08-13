import {
  TENANT_SCOPE_MAP,
  TenantScopeError,
  applyTenantScope,
  assertTenantMapComplete,
  scopeFilterFor,
  tenantScopeMiddleware,
} from './tenant-scope'
import { runUnscoped, runWithTenant } from './tenant-context'

/**
 * Regression cover for C2(a): a tenant-scoped query must never be able to read
 * or write another organization's rows, and a query that somehow runs with no
 * tenant at all must be caught rather than silently returning everything.
 */
const ORG = 'org_acme'
const OTHER = 'org_globex'

function withMode<T>(mode: string, fn: () => T): T {
  const prev = process.env.TENANT_SCOPE_MODE
  process.env.TENANT_SCOPE_MODE = mode
  try {
    return fn()
  } finally {
    process.env.TENANT_SCOPE_MODE = prev
  }
}

beforeEach(() => {
  process.env.TENANT_SCOPE_MODE = 'enforce'
})

describe('scopeFilterFor', () => {
  it('filters on organizationId for a model that owns the column', () => {
    expect(scopeFilterFor('Affiliate', ORG)).toEqual({ organizationId: ORG })
  })

  it('filters Organization itself on its primary key', () => {
    expect(scopeFilterFor('Organization', ORG)).toEqual({ id: ORG })
  })

  it('walks the relation for models with no organizationId column', () => {
    // These three tables reach their tenant through a parent row.
    expect(scopeFilterFor('Order', ORG)).toEqual({ store: { organizationId: ORG } })
    expect(scopeFilterFor('OrderItem', ORG)).toEqual({ order: { store: { organizationId: ORG } } })
    expect(scopeFilterFor('Commission', ORG)).toEqual({ affiliate: { organizationId: ORG } })
  })

  it('leaves shared reference data unscoped', () => {
    expect(scopeFilterFor('Permission', ORG)).toBeNull()
    expect(scopeFilterFor('RolePermission', ORG)).toBeNull()
    expect(scopeFilterFor('GatewayEvent', ORG)).toBeNull()
  })
})

describe('applyTenantScope - reads', () => {
  it('narrows a findMany to the active organization', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Affiliate', 'findMany', { where: { status: 'active' } }),
    )
    expect(out.where).toEqual({ status: 'active', organizationId: ORG })
  })

  it('cannot be widened by a caller passing a different organizationId', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Affiliate', 'findMany', { where: { organizationId: OTHER } }),
    )
    expect(out.where.organizationId).toBe(ORG)
  })

  it('adds a where clause when the caller supplied none', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Payout', 'count', {}),
    )
    expect(out.where).toEqual({ organizationId: ORG })
  })

  it('scopes lookups by unique id, so another org cannot be fetched by guessing an id', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Store', 'findUnique', { where: { id: 'store_from_other_org' } }),
    )
    expect(out.where).toEqual({ id: 'store_from_other_org', organizationId: ORG })
  })

  it('scopes relation-backed models through their parent', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Order', 'findMany', { where: { status: 'paid' } }),
    )
    expect(out.where).toEqual({ status: 'paid', store: { organizationId: ORG } })
  })

  it('preserves an OR clause, which Prisma ANDs with the tenant filter', () => {
    const or = [{ status: 'paid' }, { status: 'refunded' }]
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Conversion', 'findMany', { where: { OR: or } }),
    )
    expect(out.where).toEqual({ OR: or, organizationId: ORG })
  })
})

describe('applyTenantScope - writes', () => {
  it('stamps the organization onto a create', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Campaign', 'create', { data: { name: 'Spring' } }),
    )
    expect(out.data).toEqual({ name: 'Spring', organizationId: ORG })
  })

  it('overrides an organizationId a caller tried to forge on create', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Campaign', 'create', { data: { name: 'X', organizationId: OTHER } }),
    )
    expect(out.data.organizationId).toBe(ORG)
  })

  it('stamps every row of a createMany', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Click', 'createMany', { data: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }] }),
    )
    expect(out.data).toEqual([
      { ip: '1.1.1.1', organizationId: ORG },
      { ip: '2.2.2.2', organizationId: ORG },
    ])
  })

  it('scopes updateMany so a bulk write cannot touch another org', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Coupon', 'updateMany', { where: { code: 'SALE' }, data: { active: false } }),
    )
    expect(out.where).toEqual({ code: 'SALE', organizationId: ORG })
  })

  it('scopes deleteMany', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Notification', 'deleteMany', { where: { read: true } }),
    )
    expect(out.where).toEqual({ read: true, organizationId: ORG })
  })

  it('scopes both halves of an upsert', () => {
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Setting', 'upsert', {
        where: { key: 'theme' },
        create: { key: 'theme', value: 'dark' },
        update: { value: 'dark' },
      }),
    )
    expect(out.where).toEqual({ key: 'theme', organizationId: ORG })
    expect(out.create).toEqual({ key: 'theme', value: 'dark', organizationId: ORG })
  })

  it('does not invent an organizationId column on relation-scoped creates', () => {
    // Order has no organizationId; stamping one would be a Prisma error.
    const out = runWithTenant({ organizationId: ORG }, () =>
      applyTenantScope('Order', 'create', { data: { storeId: 's1' } }),
    )
    expect(out.data).toEqual({ storeId: 's1' })
  })
})

describe('applyTenantScope - missing context', () => {
  it('throws in enforce mode rather than returning every tenant', () => {
    expect(() => applyTenantScope('Affiliate', 'findMany', {})).toThrow(TenantScopeError)
  })

  it('warns but allows in warn mode, so the rollout can be staged', () => {
    withMode('warn', () => {
      const args = { where: { status: 'active' } }
      expect(applyTenantScope('Affiliate', 'findMany', args)).toEqual(args)
    })
  })

  it('is a no-op when disabled', () => {
    withMode('off', () => {
      expect(applyTenantScope('Affiliate', 'findMany', {})).toEqual({})
    })
  })

  it('allows shared reference data with no context at all', () => {
    expect(() => applyTenantScope('Permission', 'findMany', {})).not.toThrow()
  })

  it('allows a deliberate runUnscoped block even in enforce mode', () => {
    const args = { where: { email: 'ada@example.com' } }
    const out = runUnscoped('login: tenant not yet known', () =>
      applyTenantScope('User', 'findMany', args),
    )
    expect(out).toEqual(args)
  })

  it('does not leak the unscoped opt-out beyond its own block', () => {
    runUnscoped('login', () => applyTenantScope('User', 'findMany', {}))
    expect(() => applyTenantScope('User', 'findMany', {})).toThrow(TenantScopeError)
  })

  it('restores the outer tenant after a nested unscoped block', () => {
    runWithTenant({ organizationId: ORG }, () => {
      runUnscoped('nested', () => applyTenantScope('User', 'findMany', {}))
      const out = applyTenantScope('User', 'findMany', {})
      expect(out.where).toEqual({ organizationId: ORG })
    })
  })
})

describe('applyTenantScope - super admin', () => {
  it('lets a super admin read across tenants', () => {
    const out = runWithTenant({ organizationId: ORG, isSuperAdmin: true }, () =>
      applyTenantScope('Affiliate', 'findMany', { where: { status: 'active' } }),
    )
    expect(out.where).toEqual({ status: 'active' })
  })
})

describe('tenantScopeMiddleware', () => {
  it('scopes the params handed to the next middleware', async () => {
    const next = jest.fn(async (p: any) => p)
    const mw = tenantScopeMiddleware()

    await runWithTenant({ organizationId: ORG }, () =>
      mw({ model: 'Affiliate', action: 'findMany', args: { where: {} } }, next),
    )

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ args: { where: { organizationId: ORG } } }),
    )
  })

  it('passes raw / non-model operations straight through', async () => {
    const next = jest.fn(async (p: any) => p)
    const mw = tenantScopeMiddleware()
    const params = { action: 'executeRaw', args: {} }

    await mw(params, next)

    expect(next).toHaveBeenCalledWith(params)
  })
})

describe('assertTenantMapComplete', () => {
  it('accepts a schema whose models are all classified', () => {
    expect(() => assertTenantMapComplete(Object.keys(TENANT_SCOPE_MAP))).not.toThrow()
  })

  it('fails when a new model has not been classified', () => {
    // Guards against a future table silently defaulting to unscoped.
    expect(() => assertTenantMapComplete([...Object.keys(TENANT_SCOPE_MAP), 'BrandNewTable'])).toThrow(
      /BrandNewTable/,
    )
  })
})
