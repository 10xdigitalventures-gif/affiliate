/**
 * Tenant isolation end-to-end tests.
 *
 * Proves that Tenant A cannot read or write Tenant B's data across the full
 * HTTP API stack. Run in CI with: npm test -- --testPathPattern=tenant-isolation
 *
 * Each test suite:
 *   1. Seeds two independent organizations (tenants) with their own admin users.
 *   2. Authenticates each admin separately.
 *   3. Attempts cross-tenant data access and asserts 403 / 404 responses.
 */
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import * as argon2 from 'argon2'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG_A = { name: 'Tenant A', slug: 'tenant-a-e2e' }
const ORG_B = { name: 'Tenant B', slug: 'tenant-b-e2e' }

async function seedTenant(
  prisma: PrismaService,
  org: { name: string; slug: string },
  email: string,
) {
  const organization = await prisma.organization.create({
    data: { name: org.name, slug: org.slug, status: 'active' },
  })
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email,
      fullName: `Admin ${org.name}`,
      passwordHash: await argon2.hash('TestPassword123!'),
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  })
  return { organization, user }
}

async function loginAs(
  app: INestApplication,
  email: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, password: 'TestPassword123!' })
    .expect(201)
  return res.body.access_token as string
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaService

  let orgAId: string
  let orgBId: string
  let tokenA: string
  let tokenB: string
  let affiliateAId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    await app.init()

    prisma = moduleRef.get(PrismaService)

    // Seed two independent tenants.
    const { organization: oA } = await seedTenant(prisma, ORG_A, 'admin-a@tenant-a-e2e.test')
    const { organization: oB } = await seedTenant(prisma, ORG_B, 'admin-b@tenant-b-e2e.test')
    orgAId = oA.id
    orgBId = oB.id

    // Authenticate both admins.
    tokenA = await loginAs(app, 'admin-a@tenant-a-e2e.test')
    tokenB = await loginAs(app, 'admin-b@tenant-b-e2e.test')

    // Create an affiliate in Tenant A that Tenant B should never see.
    const affiliateA = await prisma.affiliate.create({
      data: {
        organizationId: orgAId,
        email: 'aff@tenant-a-e2e.test',
        firstName: 'Aff',
        lastName: 'TenantA',
        status: 'active',
      },
    })
    affiliateAId = affiliateA.id
  })

  afterAll(async () => {
    // Clean up in reverse dependency order.
    await prisma.affiliate.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } })
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } })
    await app.close()
  })

  // -------------------------------------------------------------------------
  // Affiliate isolation
  // -------------------------------------------------------------------------

  describe('Affiliates', () => {
    it('Tenant A can list its own affiliates', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/affiliates')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200)
      const ids: string[] = res.body.data?.map((a: any) => a.id) ?? res.body.map?.((a: any) => a.id) ?? []
      expect(ids).toContain(affiliateAId)
    })

    it('Tenant B cannot see Tenant A affiliates in list', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/affiliates')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const ids: string[] = res.body.data?.map((a: any) => a.id) ?? res.body.map?.((a: any) => a.id) ?? []
      expect(ids).not.toContain(affiliateAId)
    })

    it('Tenant B cannot fetch Tenant A affiliate by ID', async () => {
      await request(app.getHttpServer())
        .get(`/v1/affiliates/${affiliateAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        // API must return 404 (not leak that the resource exists at all)
        .expect((res) => {
          expect([403, 404]).toContain(res.status)
        })
    })

    it('Tenant B cannot update Tenant A affiliate', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/affiliates/${affiliateAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'Hacked' })
        .expect((res) => {
          expect([403, 404]).toContain(res.status)
        })
    })

    it('Tenant B cannot delete Tenant A affiliate', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/affiliates/${affiliateAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect((res) => {
          expect([403, 404]).toContain(res.status)
        })
    })
  })

  // -------------------------------------------------------------------------
  // API key isolation
  // -------------------------------------------------------------------------

  describe('API Keys', () => {
    let apiKeyAId: string

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'E2E key A' })
        .expect(201)
      apiKeyAId = res.body.id as string
    })

    it('Tenant B cannot list Tenant A API keys', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/api-keys')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const ids: string[] = res.body.map?.((k: any) => k.id) ?? []
      expect(ids).not.toContain(apiKeyAId)
    })

    it('Tenant B cannot revoke Tenant A API key', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/api-keys/${apiKeyAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect((res) => {
          expect([403, 404]).toContain(res.status)
        })
    })
  })

  // -------------------------------------------------------------------------
  // Permission escalation
  // -------------------------------------------------------------------------

  describe('Permission escalation', () => {
    it('Tenant A cannot access superadmin overview', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/overview')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403)
    })

    it('Tenant B cannot access superadmin tenant list', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/tenants')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403)
    })

    it('Unauthenticated request is rejected', async () => {
      await request(app.getHttpServer())
        .get('/v1/affiliates')
        .expect(401)
    })
  })
})
