import { TenantResolverService } from './tenant-resolver.service'

describe('TenantResolverService', () => {
  const originalRootDomains = process.env.TENANT_ROOT_DOMAINS

  function makeService() {
    const prisma: any = {
      organization: { findUnique: jest.fn() },
      domain: { findUnique: jest.fn() },
    }
    return { prisma, service: new TenantResolverService(prisma) }
  }

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalRootDomains === undefined) delete process.env.TENANT_ROOT_DOMAINS
    else process.env.TENANT_ROOT_DOMAINS = originalRootDomains
  })

  it('normalizes forwarded host values, ports, casing, and trailing dots', () => {
    expect(TenantResolverService.normalizeHostname(' Acme.Example.com:443., proxy.internal ')).toBe(
      'acme.example.com',
    )
    expect(TenantResolverService.normalizeHostname(['Tenant.Example.com:8443'])).toBe(
      'tenant.example.com',
    )
  })

  it('normalizes valid slugs and rejects invalid tenant hints', () => {
    expect(TenantResolverService.normalizeSlug(' Acme-Store ')).toBe('acme-store')
    expect(TenantResolverService.normalizeSlug('bad.slug')).toBeNull()
    expect(TenantResolverService.normalizeSlug('-bad')).toBeNull()
  })

  it('prefers an explicit workspace slug', async () => {
    const { prisma, service } = makeService()
    const org = { id: 'org1', slug: 'acme', name: 'Acme' }
    prisma.organization.findUnique.mockResolvedValue(org)

    await expect(service.resolve({ orgSlug: 'Acme', hostname: 'other.example.com' })).resolves.toEqual(org)
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
      select: { id: true, slug: true, name: true },
    })
    expect(prisma.domain.findUnique).not.toHaveBeenCalled()
  })

  it('resolves only active verified login domains', async () => {
    const { prisma, service } = makeService()
    const org = { id: 'org1', slug: 'acme', name: 'Acme' }
    prisma.domain.findUnique.mockResolvedValue({ status: 'active', purpose: 'login', organization: org })

    await expect(service.resolve({ hostname: 'login.acme.test:443' })).resolves.toEqual(org)

    prisma.domain.findUnique.mockResolvedValue({ status: 'pending', purpose: 'login', organization: org })
    await expect(service.resolve({ hostname: 'pending.acme.test' })).resolves.toBeNull()

    prisma.domain.findUnique.mockResolvedValue({ status: 'active', purpose: 'tracking', organization: org })
    await expect(service.resolve({ hostname: 'track.acme.test' })).resolves.toBeNull()
  })

  it('resolves a configured single-label tenant subdomain', async () => {
    process.env.TENANT_ROOT_DOMAINS = 'app.example.com'
    const { prisma, service } = makeService()
    const org = { id: 'org1', slug: 'acme', name: 'Acme' }
    prisma.domain.findUnique.mockResolvedValue(null)
    prisma.organization.findUnique.mockImplementation(async ({ where }: any) =>
      where.slug === 'acme' ? org : null,
    )

    await expect(service.resolve({ hostname: 'Acme.app.example.com:443' })).resolves.toEqual(org)
  })

  it('does not map reserved or nested platform subdomains to tenants', async () => {
    process.env.TENANT_ROOT_DOMAINS = 'app.example.com'
    const { prisma, service } = makeService()
    prisma.domain.findUnique.mockResolvedValue(null)

    await expect(service.resolve({ hostname: 'api.app.example.com' })).resolves.toBeNull()
    await expect(service.resolve({ hostname: 'nested.acme.app.example.com' })).resolves.toBeNull()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })
})
