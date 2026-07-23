import { Prisma } from '@prisma/client'
import { CommissionsService } from './commissions.service'

/**
 * Unit tests for the multi-tier / sub-affiliate override engine.
 * Prisma + audit + mail are stubbed; we assert the override math and chain walk.
 */
describe('CommissionsService — multi-tier overrides', () => {
  function makeService(opts: {
    settings: Record<string, unknown>
    parents: Record<string, string | null>
    approved: Set<string>
  }) {
    const created: any[] = []
    const prisma: any = {
      organization: {
        findUnique: async () => ({ settings: opts.settings }),
      },
      affiliate: {
        findUnique: async ({ where }: any) => ({ parentAffiliateId: opts.parents[where.id] ?? null }),
        findFirst: async ({ where }: any) =>
          opts.approved.has(where.id) ? { id: where.id } : null,
      },
      commission: {
        upsert: async ({ create: data }: any) => {
          created.push(data)
          return { id: `c_${created.length}`, ...data }
        },
      },
    }
    const audit: any = { log: async () => {} }
    const mail: any = { send: async () => {} }
    const notifications: any = { notifyUser: async () => null, notifyOrgAdmins: async () => 0 }
    const entitlements: any = { can: async () => true }
    const svc = new CommissionsService(prisma, audit, mail, notifications, entitlements)
    return { svc, created }
  }

  const order = { id: 'o1', storeId: 's1', subtotal: new Prisma.Decimal(200), total: new Prisma.Decimal(200), currency: 'USD' }

  it('does nothing when disabled', async () => {
    const { svc, created } = makeService({ settings: { subAffiliateEnabled: false }, parents: {}, approved: new Set() })
    await svc.generateOverrides('org1', order as any, 'seller', 'src', new Prisma.Decimal(20))
    expect(created).toHaveLength(0)
  })

  it('rewards a single approved parent at the configured rate', async () => {
    const { svc, created } = makeService({
      settings: { subAffiliateEnabled: true, subAffiliateRate: 10, subAffiliateMaxDepth: 1 },
      parents: { seller: 'p1' },
      approved: new Set(['p1']),
    })
    await svc.generateOverrides('org1', order as any, 'seller', 'src', new Prisma.Decimal(20))
    expect(created).toHaveLength(1)
    expect(created[0].affiliateId).toBe('p1')
    expect(created[0].tier).toBe(1)
    expect(created[0].sourceCommissionId).toBe('src')
    // 20 * 10% = 2
    expect(Number(created[0].amount)).toBeCloseTo(2)
  })

  it('walks multiple tiers with decay', async () => {
    const { svc, created } = makeService({
      settings: { subAffiliateEnabled: true, subAffiliateRate: 10, subAffiliateMaxDepth: 3, subAffiliateDecay: 0.5 },
      parents: { seller: 'p1', p1: 'p2', p2: 'p3' },
      approved: new Set(['p1', 'p2', 'p3']),
    })
    await svc.generateOverrides('org1', order as any, 'seller', 'src', new Prisma.Decimal(20))
    expect(created).toHaveLength(3)
    // tier1: 20*10%=2 ; tier2: 20*(10%*0.5)=1 ; tier3: 20*(10%*0.25)=0.5
    expect(Number(created[0].amount)).toBeCloseTo(2)
    expect(Number(created[1].amount)).toBeCloseTo(1)
    expect(Number(created[2].amount)).toBeCloseTo(0.5)
  })

  it('stops at the top of the chain', async () => {
    const { svc, created } = makeService({
      settings: { subAffiliateEnabled: true, subAffiliateRate: 10, subAffiliateMaxDepth: 5 },
      parents: { seller: 'p1', p1: null },
      approved: new Set(['p1']),
    })
    await svc.generateOverrides('org1', order as any, 'seller', 'src', new Prisma.Decimal(20))
    expect(created).toHaveLength(1)
  })

  it('skips non-approved parents but keeps walking', async () => {
    const { svc, created } = makeService({
      settings: { subAffiliateEnabled: true, subAffiliateRate: 10, subAffiliateMaxDepth: 2 },
      parents: { seller: 'p1', p1: 'p2' },
      approved: new Set(['p2']), // p1 not approved
    })
    await svc.generateOverrides('org1', order as any, 'seller', 'src', new Prisma.Decimal(20))
    expect(created).toHaveLength(1)
    expect(created[0].affiliateId).toBe('p2')
  })
})
