import { Test } from '@nestjs/testing'
import { Prisma } from '@prisma/client'
import { CommissionsService } from './commissions.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'

const D = (n: number | string) => new Prisma.Decimal(n)
const order = { id: 'order-1', storeId: 'store-1', subtotal: D(100), total: D(110), currency: 'USD' }

describe('CommissionsService product/category overrides', () => {
  let service: CommissionsService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      commissionRule: { findMany: jest.fn() },
      orderItem: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notifyUser: jest.fn().mockResolvedValue(null), notifyOrgAdmins: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile()
    service = moduleRef.get(CommissionsService)
  })

  it('applies a per-product rule to its own line and a category rule to another', async () => {
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'i1', productId: 'p1', quantity: 2, unitPrice: D(10), product: { categoryId: 'c9' } }, // 20 base
      { id: 'i2', productId: 'p2', quantity: 1, unitPrice: D(50), product: { categoryId: 'c9' } }, // 50 base -> category rule
    ])
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 'r-prod', scope: 'product', scopeRefId: 'p1', priority: 0, type: 'percentage', value: D(20) }, // 20% of 20 = 4
      { id: 'r-cat', scope: 'category', scopeRefId: 'c9', priority: 0, type: 'percentage', value: D(10) }, // 10% of 50 = 5 (p2)
    ])
    const res = await service.computeOrderCommission('org-1', order as any, 'aff-1')
    expect(res).not.toBeNull()
    // line i1: product rule wins over category (scope rank) -> 4; line i2: category -> 5
    expect(res!.amount.toString()).toBe('9')
    expect(res!.breakdown).toHaveLength(2)
    expect(res!.breakdown.find((b) => b.itemId === 'i1')!.amount.toString()).toBe('4')
    expect(res!.breakdown.find((b) => b.itemId === 'i2')!.amount.toString()).toBe('5')
  })

  it('fixed product rule is applied per-unit (value * quantity)', async () => {
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'i1', productId: 'p1', quantity: 3, unitPrice: D(10), product: { categoryId: null } },
    ])
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 'r-prod', scope: 'product', scopeRefId: 'p1', priority: 0, type: 'fixed', value: D(2) },
    ])
    const res = await service.computeOrderCommission('org-1', order as any, 'aff-1')
    expect(res!.amount.toString()).toBe('6') // 2 * 3
  })

  it('higher priority order-level rule overrides product scope rank', async () => {
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'i1', productId: 'p1', quantity: 1, unitPrice: D(100), product: { categoryId: null } },
    ])
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 'r-prod', scope: 'product', scopeRefId: 'p1', priority: 0, type: 'percentage', value: D(5) }, // rank 40
      { id: 'r-aff', scope: 'affiliate', scopeRefId: 'aff-1', priority: 100, type: 'percentage', value: D(30) }, // priority wins
    ])
    const res = await service.computeOrderCommission('org-1', order as any, 'aff-1')
    expect(res!.breakdown[0].ruleId).toBe('r-aff')
    expect(res!.amount.toString()).toBe('30') // 30% of 100
  })

  it('falls back to order-level when no product/category rules exist', async () => {
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'i1', productId: 'p1', quantity: 1, unitPrice: D(100), product: { categoryId: null } },
    ])
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 'r-store', scope: 'store', scopeRefId: 'store-1', priority: 0, type: 'percentage', value: D(8) },
    ])
    const res = await service.computeOrderCommission('org-1', order as any, 'aff-1')
    expect(res!.breakdown).toHaveLength(0)
    expect(res!.amount.toString()).toBe('8') // 8% of order subtotal 100
  })
})
