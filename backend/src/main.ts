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
  const REQUIRED_ENV = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k])
  if (missingEnv.length > 0 && process.env.NODE_ENV === 'production') {
    console.error(`FATAL: missing required env vars: ${missingEnv.join(', ')}`)
    console.error('Set these in your .env or deployment secrets before starting the server.')
    process.exit(1)
  }
  if (process.env.JWT_ACCESS_SECRET === 'change-me-to-a-long-random-secret' && process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_ACCESS_SECRET is still set to the example placeholder.')
    process.exit(1)
  }

  // ── Sentry ───────────────────────────────────────────────────────────────
  // Initialise error tracking as early as possible (no-op if SENTRY_DSN unset).
  const sentryOn = initSentry()

  // rawBody: true keeps the untouched request body available for webhook HMAC verification.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  // Consistent JSON error envelope + Sentry reporting for 5xx.
  app.useGlobalFilters(new AllExceptionsFilter())

  // Trust the first proxy hop (nginx / load balancer) so req.ip reflects the real
  // client address — required for accurate per-IP rate limiting behind a proxy.
  const httpAdapter = app.getHttpAdapter()
  const instance: any = httpAdapter.getInstance?.()
  if (instance?.set) instance.set('trust proxy', 1)

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  })

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  )

  // ─── OpenAPI / Swagger docs ──────────────────────────────────────────────────
  // FAIL-CLOSED: Swagger is disabled by default in all environments.
  // Enable only by explicitly setting SWAGGER_ENABLED=true.
  // Never set SWAGGER_ENABLED=true in production deployments.
  const swaggerEnabled = process.env.SWAGGER_ENABLED === 'true'
  Logger.log(`Swagger docs: ${swaggerEnabled ? 'ENABLED' : 'DISABLED'} (SWAGGER_ENABLED=${process.env.SWAGGER_ENABLED ?? 'unset'})`, 'Bootstrap')

  if (swaggerEnabled) {
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
  await app.listen(port)
  Logger.log(`API running on http://localhost:${port}/${prefix}`, 'Bootstrap')
  Logger.log(`Error tracking (Sentry): ${sentryOn ? 'enabled' : 'disabled'}`, 'Bootstrap')
}
bootstrap()
