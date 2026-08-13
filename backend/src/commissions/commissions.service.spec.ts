import { Test } from '@nestjs/testing'
import { Prisma } from '@prisma/client'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CommissionsService } from './commissions.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'

const D = (n: number | string) => new Prisma.Decimal(n)

const order = {
  id: 'order-1',
  storeId: 'store-1',
  subtotal: D(100),
  total: D(110),
  currency: 'USD',
}

describe('CommissionsService', () => {
  let service: CommissionsService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      commissionRule: { findMany: jest.fn() },
      commission: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      conversion: { create: jest.fn() },
      commissionAdjustment: { create: jest.fn() },
      affiliate: { findUnique: jest.fn() },
      organization: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
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

  describe('computeAmount', () => {
    it('percentage: 10% of 100 subtotal = 10', () => {
      const result = service.computeAmount({ type: 'percentage', value: D(10) }, order)
      expect(result.toString()).toBe('10')
    })

    it('percentage uses subtotal not total', () => {
      // 20% of subtotal(100) = 20, NOT 20% of total(110)=22
      const result = service.computeAmount({ type: 'percentage', value: D(20) }, order)
      expect(result.toString()).toBe('20')
    })

    it('fixed: returns flat value regardless of order size', () => {
      const result = service.computeAmount({ type: 'fixed', value: D(15) }, order)
      expect(result.toString()).toBe('15')
    })

    it('tiered is treated as percentage', () => {
      expect(service.computeAmount({ type: 'tiered', value: D(5) }, order).toString()).toBe('5')
    })

    it('recurring is treated as percentage', () => {
      expect(service.computeAmount({ type: 'recurring', value: D(50) }, order).toString()).toBe('50')
    })

    it('unknown type returns 0', () => {
      expect(service.computeAmount({ type: 'bogus', value: D(99) }, order).toString()).toBe('0')
    })

    it('handles fractional percentages precisely', () => {
      // 12.5% of 100 = 12.5
      expect(service.computeAmount({ type: 'percentage', value: D('12.5') }, order).toString()).toBe('12.5')
    })
  })

  describe('findRule priority', () => {
    it('returns null when no rules match', async () => {
      prisma.commissionRule.findMany.mockResolvedValue([])
      expect(await service.findRule('org-1', order, 'aff-1')).toBeNull()
    })

    it('higher priority wins regardless of scope', async () => {
      prisma.commissionRule.findMany.mockResolvedValue([
        { id: 'r-global', scope: 'global', priority: 100, type: 'percentage', value: D(5) },
        { id: 'r-aff', scope: 'affiliate', priority: 1, type: 'percentage', value: D(30) },
      ])
      const rule = await service.findRule('org-1', order, 'aff-1')
      expect(rule!.id).toBe('r-global')
    })

    it('on equal priority, affiliate scope beats store beats global', async () => {
      prisma.commissionRule.findMany.mockResolvedValue([
        { id: 'r-global', scope: 'global', priority: 10, type: 'percentage', value: D(5) },
        { id: 'r-store', scope: 'store', priority: 10, type: 'percentage', value: D(8) },
        { id: 'r-aff', scope: 'affiliate', priority: 10, type: 'percentage', value: D(20) },
      ])
      const rule = await service.findRule('org-1', order, 'aff-1')
      expect(rule!.id).toBe('r-aff')
    })
  })

  describe('generateForOrder', () => {
    it('is idempotent: returns existing commission without creating', async () => {
      prisma.commission.findFirst.mockResolvedValue({ id: 'existing' })
      const result = await service.generateForOrder('org-1', order, 'aff-1', { method: 'coupon' })
      expect(result).toEqual({ id: 'existing' })
      expect(prisma.commission.create).not.toHaveBeenCalled()
    })

    it('returns null when no matching rule', async () => {
      prisma.commission.findFirst.mockResolvedValue(null)
      prisma.commissionRule.findMany.mockResolvedValue([])
      const result = await service.generateForOrder('org-1', order, 'aff-1', { method: 'coupon' })
      expect(result).toBeNull()
    })

    it('creates pending commission + conversion with computed amount', async () => {
      prisma.commission.findFirst.mockResolvedValue(null)
      prisma.commissionRule.findMany.mockResolvedValue([
        { id: 'r-aff', scope: 'affiliate', priority: 10, type: 'percentage', value: D(15) },
      ])
      prisma.commission.create.mockReturnValue({ id: 'c-new', status: 'pending' })
      prisma.conversion.create.mockReturnValue({ id: 'conv-new' })
      const result = await service.generateForOrder('org-1', order, 'aff-1', { method: 'cookie', clickId: 'click-1' })
      expect(result).toEqual({ id: 'c-new', status: 'pending' })
      const commissionArg = prisma.commission.create.mock.calls[0][0].data
      expect(commissionArg.amount.toString()).toBe('15')
      expect(commissionArg.status).toBe('pending')
      expect(commissionArg.affiliateId).toBe('aff-1')
    })
  })

  describe('approve', () => {
    it('rejects approving a paid commission', async () => {
      prisma.commission.findFirst.mockResolvedValue({ id: 'c-1', status: 'paid', affiliateId: 'aff-1' })
      await expect(service.approve('org-1', 'c-1')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('throws NotFound for missing commission', async () => {
      prisma.commission.findFirst.mockResolvedValue(null)
      await expect(service.approve('org-1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('approves a pending commission', async () => {
      prisma.commission.findFirst.mockResolvedValue({ id: 'c-1', status: 'pending', affiliateId: 'aff-1' })
      prisma.commission.update.mockResolvedValue({ id: 'c-1', status: 'approved', amount: D(10), currency: 'USD' })
      prisma.affiliate.findUnique.mockResolvedValue(null)
      const result = await service.approve('org-1', 'c-1')
      expect(result.status).toBe('approved')
    })
  })

  describe('markPayable', () => {
    it('only approved commissions can become payable', async () => {
      prisma.commission.findFirst.mockResolvedValue({ id: 'c-1', status: 'pending', affiliateId: 'aff-1' })
      await expect(service.markPayable('org-1', 'c-1')).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('handleRefund', () => {
    it('full refund reverses commission fully', async () => {
      prisma.commission.findMany.mockResolvedValue([{ id: 'c-1', amount: D(20) }])
      await service.handleRefund({ id: 'order-1', total: D(100), refundAmount: D(100) })
      const adj = prisma.commissionAdjustment.create.mock.calls[0][0].data
      expect(adj.type).toBe('reversal')
      expect(adj.delta.toString()).toBe('-20')
      const upd = prisma.commission.update.mock.calls[0][0]
      expect(upd.data.status).toBe('reversed')
    })

    it('partial refund creates proportional negative adjustment', async () => {
      prisma.commission.findMany.mockResolvedValue([{ id: 'c-1', amount: D(20) }])
      // 50 of 100 refunded => 50% => delta = -10
      await service.handleRefund({ id: 'order-1', total: D(100), refundAmount: D(50) })
      const adj = prisma.commissionAdjustment.create.mock.calls[0][0].data
      expect(adj.type).toBe('partial_refund')
      expect(adj.delta.toString()).toBe('-10')
    })

    it('does nothing when total <= 0', async () => {
      prisma.commission.findMany.mockResolvedValue([{ id: 'c-1', amount: D(20) }])
      await service.handleRefund({ id: 'order-1', total: D(0), refundAmount: D(0) })
      expect(prisma.commissionAdjustment.create).not.toHaveBeenCalled()
    })

    it('caps refund ratio at 100% even if overrefunded', async () => {
      prisma.commission.findMany.mockResolvedValue([{ id: 'c-1', amount: D(20) }])
      await service.handleRefund({ id: 'order-1', total: D(100), refundAmount: D(150) })
      const adj = prisma.commissionAdjustment.create.mock.calls[0][0].data
      // ratio capped at 1 => full -20
      expect(adj.delta.toString()).toBe('-20')
      expect(adj.type).toBe('reversal')
    })
  })
})
