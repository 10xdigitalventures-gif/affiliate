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
 * Seed logins: admin@demo.test / password123
 */
describe('Auth & protected routes (e2e)', () => {
  let app: INestApplication
  let token: string

  beforeAll(async () => {
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
      .send({ email: 'admin@demo.test', password: 'wrong' })
      .expect((res) => {
        if (![400, 401].includes(res.status)) throw new Error(`expected 400/401, got ${res.status}`)
      })
  })

  it('logs in with seed admin and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'admin@demo.test', password: 'password123' })
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
