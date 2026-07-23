# Security & API Docs

## 1. Rate limiting (`@nestjs/throttler`)

Applied **globally** via `ThrottlerGuard` (see `app.module.ts`).

| Scope | Limit | Configurable |
|---|---|---|
| Global default (all routes) | 120 req / 60s per IP | `RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_MS` |
| `POST /v1/auth/login` | 5 req / 60s per IP | hard-coded (brute-force) |
| `POST /v1/signup/:orgSlug` | 3 req / 60s per IP | hard-coded (spam) |
| `GET /v1/health*` | unlimited | `@SkipThrottle()` |

Exceeding a limit returns **429 Too Many Requests**.

- Override per route: `@Throttle({ default: { ttl, limit } })`
- Exempt a route: `@SkipThrottle()`
- `trust proxy` is enabled in `main.ts` so `req.ip` is correct behind nginx / a load balancer.

## 2. Security headers (`helmet`)

`helmet()` is applied in `main.ts` (HSTS, X-Content-Type-Options, X-Frame-Options, etc.).
CSP is disabled because the API is JSON-only; enable it if you serve HTML.

## 3. CORS

Configured from `CORS_ORIGIN` (comma-separated allowlist, or `*`).
Allowed headers include `Authorization` and `x-api-key`.

## 4. Health probes

| Endpoint | Use |
|---|---|
| `GET /v1/health` | Liveness (process up + uptime) |
| `GET /v1/health/ready` | Readiness (runs `SELECT 1` on the DB) |

Wire these into Docker `healthcheck` / k8s liveness+readiness probes.

---

## 5. API documentation (Swagger / OpenAPI)

Interactive docs auto-generated with `@nestjs/swagger`.

- **URL:** `http://localhost:4000/v1/docs`
- **OpenAPI JSON:** `http://localhost:4000/v1/docs-json`
- Disable in production with `SWAGGER_ENABLED=false`.

### Auth in Swagger UI

Two security schemes are registered (click **Authorize**):

1. **jwt** — Bearer token from `POST /v1/auth/login` → use for dashboard/portal routes.
2. **apiKey** — `x-api-key: aff_live_...` → use for `POST /v1/orders/ingest/apikey`.

`persistAuthorization` is on, so your token survives page reloads.

### Adding docs to new endpoints

```ts
@ApiTags('my-feature')
@ApiBearerAuth('jwt')            // JWT-protected controller
@Controller('my-feature')
export class MyController {
  @ApiOperation({ summary: 'Do the thing' })
  @Get()
  find() { /* ... */ }
}
```

For DTOs, annotate fields with `@ApiProperty()` / `@ApiPropertyOptional()` (see `create-apikey.dto.ts`).
Routes without decorators still appear — tags/summaries just make the UI nicer.
