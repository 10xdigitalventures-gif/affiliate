import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { initSentry } from './observability/sentry'
import { AllExceptionsFilter } from './observability/all-exceptions.filter'

async function bootstrap() {
  // ── Production startup guard ─────────────────────────────────────────────
  // Refuse to boot in production with missing or obviously-insecure secrets.
  // This turns a "silently broken" deploy into a loud, unmissable failure.
  const production = process.env.NODE_ENV === 'production'
  const REQUIRED_ENV = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'CORS_ORIGIN']
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k])
  if (missingEnv.length > 0 && production) {
    console.error(`FATAL: missing required env vars: ${missingEnv.join(', ')}`)
    console.error('Set these in your .env or deployment secrets before starting the server.')
    process.exit(1)
  }
  if (production) {
    const secretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const
    const values = secretNames.map((name) => ({ name, value: process.env[name]?.trim() ?? '' }))
    const unsafe = values.filter(({ value }) =>
      value.length < 32 || /change-me|replace_with|example|password/i.test(value),
    )
    if (unsafe.length > 0) {
      console.error(`FATAL: insecure or placeholder secrets: ${unsafe.map((item) => item.name).join(', ')}`)
      process.exit(1)
    }
    if (new Set(values.map((item) => item.value)).size !== values.length) {
      console.error('FATAL: JWT and encryption secrets must all be different.')
      process.exit(1)
    }
    if (process.env.CORS_ORIGIN?.split(',').some((origin) => origin.trim() === '*')) {
      console.error('FATAL: wildcard CORS is not permitted in production.')
      process.exit(1)
    }
  }

  // ── Sentry ───────────────────────────────────────────────────────────────
  // Initialise error tracking as early as possible (no-op if SENTRY_DSN unset).
  const sentryOn = initSentry()

  // rawBody: true keeps the untouched request body available for webhook HMAC verification.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  // Consistent JSON error envelope + Sentry reporting for 5xx.
  app.useGlobalFilters(new AllExceptionsFilter())

  // Trust only explicitly approved proxy networks. A numeric "1" would let a
  // client that reaches the API directly spoof x-forwarded-for and evade the
  // per-IP login/rate limits. Cloudflared on this Windows test host is loopback;
  // Docker/nginx deployments can opt into linklocal/uniquelocal via TRUST_PROXY.
  const httpAdapter = app.getHttpAdapter()
  const instance: any = httpAdapter.getInstance?.()
  const trustedProxy = process.env.TRUST_PROXY?.trim() || (process.env.NODE_ENV === 'production' ? 'loopback' : '')
  if (instance?.set && trustedProxy) instance.set('trust proxy', trustedProxy)

  // Security headers (CSP disabled here since the API is JSON-only and served
  // separately from the web app; enable/customize if you serve HTML).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  )

  const prefix = process.env.API_PREFIX || 'v1'
  app.setGlobalPrefix(prefix)

  // CORS: comma-separated allowlist via CORS_ORIGIN env var.
  // Defaults to localhost:3000 for local dev. Never use '*' in production —
  // set CORS_ORIGIN=https://yourdomain.com in your deployment config.
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000'
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-auth-mode'],
  })

  // HttpOnly session cookies are protected against cross-site form/subdomain
  // attacks as well as ordinary CORS abuse. Machine webhooks and API-key or
  // bearer clients do not carry these cookies and are unaffected.
  const allowedMutationOrigins = new Set(
    [
      ...corsOrigin.split(','),
      process.env.APP_URL || '',
    ]
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter((origin) => origin && origin !== '*'),
  )
  app.use((req: any, res: any, next: () => void) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method).toUpperCase())) return next()
    const cookie = typeof req.headers?.cookie === 'string' ? req.headers.cookie : ''
    const hasSessionCookie = /(?:^|;\s*)affiliate_(?:access|refresh)=/.test(cookie)
    if (!hasSessionCookie) return next()
    const origin = typeof req.headers?.origin === 'string' ? req.headers.origin.replace(/\/$/, '') : ''
    if (!origin || !allowedMutationOrigins.has(origin)) {
      res.status(403).json({ statusCode: 403, message: 'Untrusted request origin' })
      return
    }
    next()
  })

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  )

  // ─── OpenAPI / Swagger docs ──────────────────────────────────────────────────
  // Disable in production by setting SWAGGER_ENABLED=false.
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Affiliate Platform API')
      .setDescription(
        'Unified multi-merchant affiliate management API.\n\n' +
          '- **Bearer auth** (JWT) for dashboard & portal routes.\n' +
          '- **x-api-key** (aff_live_...) for machine-to-machine order ingest.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'jwt',
      )
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'apiKey')
      .addTag('auth', 'Login & tokens')
      .addTag('affiliates', 'Affiliate management')
      .addTag('commissions', 'Commission ledger')
      .addTag('orders', 'Order ingest & refunds')
      .addTag('payouts', 'Payout lifecycle')
      .addTag('api-keys', 'Programmatic API keys')
      .addTag('signup', 'Public affiliate signup')
      .addTag('health', 'Liveness & readiness probes')
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: 'Affiliate Platform API Docs',
    })
    Logger.log(`Swagger docs at http://localhost:${process.env.API_PORT || 4000}/${prefix}/docs`, 'Bootstrap')
  }

  const port = Number(process.env.API_PORT) || 4000
  const host = process.env.API_HOST || (production ? '127.0.0.1' : '0.0.0.0')
  await app.listen(port, host)
  Logger.log(`API running on http://${host}:${port}/${prefix}`, 'Bootstrap')
  Logger.log(`Error tracking (Sentry): ${sentryOn ? 'enabled' : 'disabled'}`, 'Bootstrap')
}
bootstrap()
