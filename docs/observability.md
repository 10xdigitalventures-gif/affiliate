# Observability Runbook

## Structured logging

All API logs are emitted as JSON (`LOG_FORMAT=json`) in production and as
human-readable pretty-print (`LOG_FORMAT=pretty`) in development.

Every log line includes:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO-8601 UTC |
| `level` | error \| warn \| log \| debug \| verbose |
| `context` | NestJS context label (controller / service name) |
| `requestId` | Trace ID from `x-request-id` header |
| `organizationId` | Active tenant (omitted for unauthenticated requests) |
| `message` | Free-form message |

Set `LOG_LEVEL` env var to control verbosity (`error`, `warn`, `log`, `debug`).

## Metrics (Prometheus)

Expose a `/metrics` endpoint by adding `@willsoto/nestjs-prometheus`:

```bash
npm install @willsoto/nestjs-prometheus prom-client
```

Key metrics to instrument:

| Metric | Type | Alert threshold |
|--------|------|-----------------|
| `http_request_duration_seconds` | Histogram | p99 > 2s |
| `http_requests_total{status=5xx}` | Counter | > 1% error rate |
| `queue_depth{queue=webhooks}` | Gauge | > 1000 jobs |
| `queue_failed_total` | Counter | Any spike |
| `db_pool_waiting` | Gauge | > 0 for 30s |

## Alerting

| Alert | Condition | Severity |
|-------|-----------|----------|
| High error rate | 5xx > 1% of requests for 5m | Critical |
| Slow API | p99 latency > 2s for 5m | Warning |
| Queue backlog | webhook queue depth > 1000 | Warning |
| Failed jobs | any failed job in 1h | Warning |
| DB pool saturation | pool wait > 30s | Critical |

## Uptime checks

Add synthetic checks to `/v1/health` from your monitoring provider
(Checkly, UptimeRobot, AWS CloudWatch Synthetics).

## Sentry

Set `SENTRY_DSN` to enable automatic error capture for uncaught exceptions
and slow transactions. The `AllExceptionsFilter` reports every 5xx to Sentry
with full context.
