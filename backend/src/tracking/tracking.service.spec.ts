import { createHash } from 'crypto'
import { TrackingService, detectDevice } from './tracking.service'

function makeService() {
  const prisma: any = {
    affiliateLink: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    affiliate: { findFirst: jest.fn() },
    click: { create: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  }
  return { service: new TrackingService(prisma), prisma }
}

describe('detectDevice', () => {
  it('classifies mobile, tablet, desktop, bot', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile')
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet')
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop')
    expect(detectDevice('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot')
    expect(detectDevice(undefined)).toBeNull()
  })
})

describe('TrackingService.recordClick', () => {
  it('returns null for unknown short code', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findUnique.mockResolvedValue(null)
    await expect(service.recordClick('NOPE', {})).resolves.toBeNull()
  })

  it('records click with hashed IP, device, clickId', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findUnique.mockResolvedValue({
      id: 'link-1',
      affiliateId: 'aff-1',
      storeId: 'store-1',
      destinationUrl: 'https://shop.example/p',
      affiliate: { affiliateCode: 'REF' },
    })
    prisma.click.create.mockResolvedValue({ id: 'clk-1' })
    prisma.affiliateLink.update.mockResolvedValue({})

    const res = await service.recordClick('AB12XY', {
      ip: '1.2.3.4, 10.0.0.1',
      userAgent: 'Mozilla/5.0 (iPhone) Mobile',
      utm: { source: 'ig', medium: '', campaign: undefined },
    })

    expect(res).toEqual({
      clickId: 'clk-1',
      affiliateCode: 'REF',
      affiliateId: 'aff-1',
      destinationUrl: 'https://shop.example/p',
    })
    const data = prisma.click.create.mock.calls[0][0].data
    // Only the first forwarded hop is hashed
    expect(data.ipHash).toBe(createHash('sha256').update('1.2.3.4').digest('hex'))
    expect(data.deviceType).toBe('mobile')
    // Empty/undefined UTM values are stripped
    expect(data.utm).toEqual({ source: 'ig' })
  })

  it('stores undefined utm when all empty', async () => {
    const { service, prisma } = makeService()
    prisma.affiliateLink.findUnique.mockResolvedValue({
      id: 'l', affiliateId: 'a', storeId: null, destinationUrl: 'https://x', affiliate: { affiliateCode: 'C' },
    })
    prisma.click.create.mockResolvedValue({ id: 'c' })
    prisma.affiliateLink.update.mockResolvedValue({})
    await service.recordClick('CODE', { utm: { source: '' } })
    expect(prisma.click.create.mock.calls[0][0].data.utm).toBeUndefined()
  })
})

describe('TrackingService.recordPixelClick', () => {
  it('returns null for unknown/unapproved referral', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue(null)
    await expect(service.recordPixelClick('org-1', 'NOPE', {})).resolves.toBeNull()
  })

  it('creates a cookieless click for an approved affiliate', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'aff-1', affiliateCode: 'REF' })
    prisma.click.create.mockResolvedValue({ id: 'clk-9' })

    const res = await service.recordPixelClick('org-1', 'REF', {
      ip: '9.9.9.9',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      landingPage: 'https://land.example',
    })
    expect(res).toEqual({ clickId: 'clk-9', affiliateId: 'aff-1', affiliateCode: 'REF' })
    const data = prisma.click.create.mock.calls[0][0].data
    expect(data.affiliateLinkId).toBeUndefined()
    expect(data.deviceType).toBe('desktop')
    expect(data.ipHash).toBe(createHash('sha256').update('9.9.9.9').digest('hex'))
  })

  it('scopes affiliate lookup to org when provided', async () => {
    const { service, prisma } = makeService()
    prisma.affiliate.findFirst.mockResolvedValue({ id: 'a', affiliateCode: 'C' })
    prisma.click.create.mockResolvedValue({ id: 'c' })
    await service.recordPixelClick('org-42', 'C', {})
    expect(prisma.affiliate.findFirst.mock.calls[0][0].where.organizationId).toBe('org-42')
  })
})
