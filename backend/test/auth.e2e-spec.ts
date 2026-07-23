import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'

/**
 * End-to-end smoke tests for the auth + protected-route flow.
 *
 * Requires a running Postgres (see docker-compose.dev.yml) and a migrated + seeded DB:
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm run prisma:migrate && npm run prisma:seed
 *   npm run test:e2e
 *
 * Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to the secure seeded account.
 */
describe('Auth & protected routes (e2e)', () => {
  let app: INestApplication
  let token: string
  const adminEmail = process.env.E2E_ADMIN_EMAIL || ''
  const adminPassword = process.env.E2E_ADMIN_PASSWORD || ''

  beforeAll(async () => {
    if (!adminEmail || !adminPassword) {
      throw new Error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD before running auth e2e tests.')
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('rejects login with bad credentials', () => {
    return request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: adminEmail, password: 'definitely-not-the-real-password' })
      .expect((res) => {
        if (![400, 401].includes(res.status)) throw new Error(`expected 400/401, got ${res.status}`)
      })
  })

  it('logs in with the securely seeded admin and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('x-auth-mode', 'bearer')
      .send({ email: adminEmail, password: adminPassword })
      .expect((r) => { if (![200, 201].includes(r.status)) throw new Error(`login failed: ${r.status}`) })
    token = res.body.accessToken ?? res.body.token ?? res.body.access_token
    expect(token).toBeTruthy()
  })

  it('blocks protected route without token', () => {
    return request(app.getHttpServer()).get('/v1/commissions').expect(401)
  })

  it('allows protected route with token', () => {
    return request(app.getHttpServer())
      .get('/v1/commissions')
      .set('Authorization', `Bearer ${token}`)
      .expect((res) => { if (res.status >= 400) throw new Error(`expected success, got ${res.status}`) })
  })

  it('rejects order ingest with an invalid API key', () => {
    return request(app.getHttpServer())
      .post('/v1/orders/ingest/apikey')
      .set('x-api-key', 'aff_live_invalidkey')
      .send({ storeId: 'x', externalOrderId: 'y', subtotal: 10, total: 10, currency: 'USD', status: 'paid' })
      .expect(401)
  })
})
