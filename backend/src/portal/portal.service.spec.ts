import { ForbiddenException } from '@nestjs/common'
import { PortalService } from './portal.service'

function makeService(limit: number, used: number) {
  const prisma: any = {
    affiliate: {
      findUnique: jest.fn().mockResolvedValue({ id: 'affiliate-1', organizationId: 'org-1', status: 'approved' }),
    },
    payout: { count: jest.fn().mockResolvedValue(used) },
  }
  const payouts: any = { requestPayout: jest.fn().mockResolvedValue({ id: 'payout-1' }) }
  const links: any = {}
  const entitlements: any = { getLimit: jest.fn().mockResolvedValue(limit) }
  return { service: new PortalService(prisma, payouts, links, entitlements), prisma, payouts }
}

describe('PortalService payout plan limits', () => {
  it('blocks a payout request after the affiliate reaches the monthly plan cap', async () => {
    const { service, payouts } = makeService(2, 2)
    await expect(service.requestPayout('affiliate-1', 'paypal', 'USD'))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(payouts.requestPayout).not.toHaveBeenCalled()
  })

  it('allows unlimited monthly payout requests', async () => {
    const { service, payouts } = makeService(-1, 99)
    await expect(service.requestPayout('affiliate-1', 'paypal', 'USD')).resolves.toEqual({ id: 'payout-1' })
    expect(payouts.requestPayout).toHaveBeenCalledWith('affiliate-1', 'org-1', 'paypal', 'USD')
  })
})
