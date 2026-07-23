# Observability

Error tracking, request tracing, and consistent error responses.

## Request IDs

`RequestIdMiddleware` tags every request with an id:
- Honours an inbound `x-request-id` (from a proxy/gateway) or mints a UUID.
- Exposed on `req.id` and echoed back in the `x-request-id` response header.
- Included in error responses and 5xx logs so one request is traceable end-to-end.

## Consistent error envelope

`AllExceptionsFilter` (global) returns:

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "requestId": "e3b0c442-...",
  "timestamp": "2026-07-10T07:40:00.000Z",
  "path": "/v1/orders"
}
```

- 5xx errors are logged with the request id + stack.
- 4xx (validation, auth, not-found, etc.) keep their original messages.

## Sentry (optional)

Sentry is **opt-in** and **fail-safe**:
- If `SENTRY_DSN` is unset **or** `@sentry/node` isn't installed, all telemetry
  calls are no-ops — the app builds and runs normally.
- Loaded via lazy `require`, so a missing package never breaks the build.

### Enable

1. `npm install` (already listed in `package.json` as `@sentry/node`).
2. Set env:

```
SENTRY_DSN=https://xxxx@oXXXX.ingest.sentry.io/XXXX
SENTRY_RELEASE=affiliate-platform@1.0.0   # optional
SENTRY_TRACES_SAMPLE_RATE=0.1             # optional, 0..1
```

On boot the log shows `Error tracking (Sentry): enabled|disabled`.

### What gets reported

- Only **5xx / unexpected** exceptions (via the global filter).
- Context attached: `requestId`, `method`, `url`, `organizationId`.
- **Secrets stripped** before send: `authorization`, `x-api-key`, `cookie` headers.

### Helpers (`src/observability/sentry.ts`)

| Function | Use |
|---|---|
| `initSentry()` | Called once at bootstrap; returns whether it enabled |
| `captureException(err, ctx?)` | Manually report an error with extra context |
| `setUser({ id, organizationId })` | Associate the current actor with events |
| `isSentryEnabled()` | Guard for optional instrumentation |
