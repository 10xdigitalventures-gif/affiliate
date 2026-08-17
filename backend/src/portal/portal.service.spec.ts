import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { PortalService } from './portal.service'

function makeService(commissions: any[] = []) {
  const tx: any = {
    commission: {
      findMany: jest.fn().mockResolvedValue(commissions),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payout: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({
        id: 'payout-1',
        items: commissions.map((item, index) => ({ id: `item-${index}`, amount: item.amount })),
        ...data,
      })),
    },
  }
  const prisma: any = {
    affiliate: {
      findUnique: jest.fn().mockResolvedValue({ id: 'affiliate-1', organizationId: 'org-1', status: 'approved' }),
    },
    $transaction: jest.fn((callback: any) => callback(tx)),
  }
  const tax: any = { assertPayoutAllowed: jest.fn().mockResolvedValue(undefined) }
  return { service: new PortalService(prisma, tax), prisma, tax, tx }
}

describe('PortalService payouts', () => {
  it('rejects accounts that are not linked to an affiliate', async () => {
    const { service } = makeService()
    await expect(service.requestPayout(null, 'paypal')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects a request with no payable commissions', async () => {
    const { service } = makeService()
    await expect(service.requestPayout('affiliate-1', 'paypal')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('claims payable commissions atomically', async () => {
    const { service, tax, tx } = makeService([{ id: 'commission-1', amount: 12.5 }])
    await expect(service.requestPayout('affiliate-1', 'paypal')).resolves.toEqual({
      id: 'payout-1', amount: 12.5, currency: 'USD', status: 'requested',
    })
    expect(tax.assertPayoutAllowed).toHaveBeenCalledWith('org-1', 'affiliate-1')
    expect(tx.commission.updateMany).toHaveBeenCalledWith({
      where: { id: 'commission-1', payoutItemId: null },
      data: { payoutItemId: 'item-0' },
    })
  })
})
