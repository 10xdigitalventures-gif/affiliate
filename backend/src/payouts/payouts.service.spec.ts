import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PayoutsService } from './payouts.service'

function makeService() {
  const prisma: any = {
    payout: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    payoutItem: { create: jest.fn(), update: jest.fn() },
    affiliate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    commission: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    affiliateBalance: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn(),
    },
    affiliateLedgerEntry: { create: jest.fn() },
    payoutMethodRecord: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pm-1', detailsEnc: Buffer.from('{}') }),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', defaultCurrency: 'USD' }) },
    $transaction: jest.fn(async (work: any) => typeof work === 'function' ? work(prisma) : Promise.all(work)),
  }
  const audit: any = { log: jest.fn(async () => ({})) }
  const mail: any = { send: jest.fn(async () => undefined), appUrl: 'http://localhost:3000' }
  const notifications: any = { notifyUser: jest.fn(async () => null), notifyOrgAdmins: jest.fn(async () => 0) }
  const crypto: any = {
    decrypt: jest.fn(() => Buffer.from(JSON.stringify({ email: 'pay@x.com' }))),
  }
  const providers: any = {
    send: jest.fn(),
    forMethod: jest.fn(() => ({ method: 'stripe' })),
  }
  const tax: any = { assertPayoutAllowed: jest.fn(async () => undefined) }
  const service = new PayoutsService(prisma, audit, mail, notifications, crypto, providers, tax)
  return { service, prisma, audit, providers }
}

describe('PayoutsService.createBatch', () => {
  it('throws when affiliate missing', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue(null)
    await expect(
      service.createBatch('org-1', { affiliateId: 'a1', method: 'manual' } as any),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws when no payable commissions', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.commission.findMany.mockResolvedValue([])
    await expect(
      service.createBatch('org-1', { affiliateId: 'a1', method: 'manual' } as any),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates payout items and links commissions', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.commission.findMany.mockResolvedValue([
      { id: 'c1', amount: 10, adjustments: [] },
      { id: 'c2', amount: 15, adjustments: [] },
    ])
    prisma.payout.create.mockResolvedValue({ id: 'p1', amount: 25, currency: 'USD', status: 'requested' })
    prisma.payoutItem.create
      .mockResolvedValueOnce({ id: 'i1' })
      .mockResolvedValueOnce({ id: 'i2' })
    prisma.payout.findUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      amount: 25,
      currency: 'USD',
      status: 'requested',
      items: [{ id: 'i1' }, { id: 'i2' }],
      affiliate: { affiliateCode: 'ABC' },
      _count: { items: 2 },
    })

    const res = await service.createBatch('org-1', { affiliateId: 'a1', method: 'manual', currency: 'USD' } as any)
    expect(res.id).toBe('p1')
    expect(prisma.commission.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.commission.updateMany.mock.calls[0][0].data.payoutItemId).toBe('i1')
    expect(prisma.affiliateLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'payout_reserved', balanceDelta: expect.anything() }),
    }))
  })
})

describe('PayoutsService.approve / fail / markPaid', () => {
  it('approves only requested payouts', async () => {
    const { service, prisma, audit } = makeService()
    prisma.payout.findFirst.mockResolvedValue({ id: 'p1', status: 'requested' })
    prisma.payout.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'approved' })
    const res = await service.approve('p1', 'org-1')
    expect(res.status).toBe('approved')
    expect(audit.log).toHaveBeenCalled()

    prisma.payout.findFirst.mockResolvedValue({ id: 'p1', status: 'paid' })
    await expect(service.approve('p1', 'org-1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('fails only requested/approved', async () => {
    const { service, prisma } = makeService()
    prisma.payout.findFirst.mockResolvedValue({
      id: 'p1', status: 'requested', affiliateId: 'a1', amount: 20, currency: 'USD', items: [],
    })
    prisma.payout.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'failed' })
    await expect(service.fail('p1', 'org-1')).resolves.toMatchObject({ status: 'failed' })

    prisma.payout.findFirst.mockResolvedValue({ id: 'p1', status: 'paid' })
    await expect(service.fail('p1', 'org-1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('markPaid settles approved payout', async () => {
    const { service, prisma } = makeService()
    prisma.payout.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'approved',
      affiliateId: 'a1',
      amount: 20,
      currency: 'USD',
      method: 'manual',
      items: [{ id: 'i1' }],
    })
    prisma.commission.updateMany.mockResolvedValue({ count: 1 })
    prisma.affiliate.update.mockResolvedValue({})
    prisma.payout.update.mockResolvedValue({})
    prisma.affiliate.findUnique.mockResolvedValue(null)

    const res = await service.markPaid('p1', 'org-1', { transactionReference: 'TX-1' } as any)
    expect(res).toEqual({ id: 'p1', status: 'paid' })
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

describe('PayoutsService.process', () => {
  it('rejects non-approved payouts', async () => {
    const { service, prisma } = makeService()
    prisma.payout.findFirst.mockResolvedValue({ id: 'p1', status: 'requested', items: [] })
    await expect(service.process('p1', 'org-1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('marks paid when provider returns paid', async () => {
    const { service, prisma, providers } = makeService()
    prisma.payout.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'approved',
      affiliateId: 'a1',
      amount: 10,
      currency: 'USD',
      method: 'stripe',
      items: [{ id: 'i1' }],
    })
    prisma.payout.update.mockResolvedValue({})
    prisma.payoutMethodRecord.findFirst.mockResolvedValue(null)
    providers.send.mockResolvedValue({ status: 'paid', reference: 'pi_1' })
    prisma.commission.updateMany.mockResolvedValue({})
    prisma.affiliate.update.mockResolvedValue({})
    prisma.affiliate.findUnique.mockResolvedValue(null)

    const res = await service.process('p1', 'org-1')
    expect(res.status).toBe('paid')
    expect(res.reference).toBe('pi_1')
  })

  it('throws when provider fails', async () => {
    const { service, prisma, providers } = makeService()
    prisma.payout.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'approved',
      affiliateId: 'a1',
      amount: 10,
      currency: 'USD',
      method: 'stripe',
      items: [],
    })
    prisma.payout.update.mockResolvedValue({})
    prisma.payoutMethodRecord.findFirst.mockResolvedValue(null)
    providers.send.mockResolvedValue({ status: 'failed', error: 'card_declined' })

    await expect(service.process('p1', 'org-1')).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('PayoutsService.requestPayout (portal)', () => {
  it('creates requested payout from payable commissions', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a1' })
    prisma.commission.findMany.mockResolvedValue([{ id: 'c1', amount: 12, adjustments: [] }])
    prisma.payout.create.mockResolvedValue({ id: 'p9', amount: 12, currency: 'USD', status: 'requested' })
    prisma.payoutItem.create.mockResolvedValue({ id: 'i9' })
    prisma.payout.findUniqueOrThrow.mockResolvedValue({
      id: 'p9', amount: 12, currency: 'USD', status: 'requested', items: [{ id: 'i9' }],
    })

    const res = await service.requestPayout('a1', 'org-1', 'paypal', 'USD')
    expect(res).toEqual({ id: 'p9', amount: 12, currency: 'USD', status: 'requested' })
  })

  it('rejects a request when that payout method has not been saved', async () => {
    const { service, prisma } = makeService()
    prisma.payoutMethodRecord.findFirst.mockResolvedValue(null)
    await expect(service.requestPayout('a1', 'org-1', 'paypal', 'USD')).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.payout.create).not.toHaveBeenCalled()
  })
})
