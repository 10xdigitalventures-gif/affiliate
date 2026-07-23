import { AffiliatesService } from './affiliates.service'

function makeService() {
  const prisma: any = {
    affiliate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  }
  const entitlements: any = { assertWithinLimit: jest.fn().mockResolvedValue(undefined) }
  return { service: new AffiliatesService(prisma, entitlements), prisma, entitlements }
}

describe('AffiliatesService', () => {
  it('normalizes manually supplied identifiers even when called outside the HTTP pipe', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.create.mockResolvedValue({ id: 'affiliate-1' })

    await service.create('org-1', { affiliateCode: ' summer_10 ', referralSlug: ' Offer-10 ' })

    expect(prisma.affiliate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        affiliateCode: 'SUMMER_10',
        referralSlug: 'offer-10',
      }),
    })
  })

  it('retries an automatically generated code after a unique collision', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'affiliate-1' })

    await expect(service.create('org-1', {})).resolves.toEqual({ id: 'affiliate-1' })
    expect(prisma.affiliate.create).toHaveBeenCalledTimes(2)
  })

  it('does not traverse an upline outside the active tenant', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst
      .mockResolvedValueOnce({ id: 'child' })
      .mockResolvedValueOnce({ id: 'parent' })
      .mockResolvedValueOnce(null)
    prisma.affiliate.update.mockResolvedValue({ id: 'child', parentAffiliateId: 'parent' })

    await service.setParent('org-1', 'child', 'parent')

    expect(prisma.affiliate.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'parent', organizationId: 'org-1' },
      select: { parentAffiliateId: true },
    })
  })
})
