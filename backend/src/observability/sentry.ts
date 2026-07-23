/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Lightweight Sentry wrapper.
 *
 * Sentry is OPTIONAL: if `@sentry/node` isn't installed or `SENTRY_DSN` is unset,
 * every helper here becomes a safe no-op so the app still builds and runs.
 * Loaded via lazy `require` so a missing package never breaks the build.
 */

let sentry: any = null
let enabled = false

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return false
  try {
    // eslint-disable-next-line global-require
    sentry = require('@sentry/node')
    sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
      // Never ship secrets: strip auth headers & api keys before send.
      beforeSend(event: any) {
        try {
          if (event.request?.headers) {
            delete event.request.headers.authorization
            delete event.request.headers['x-api-key']
            delete event.request.headers.cookie
          }
        } catch {
          /* ignore */
        }
        return event
      },
    })
    enabled = true
    return true
  } catch {
    // Package not installed — run without Sentry.
    sentry = null
    enabled = false
    return false
  }
}

export function isSentryEnabled(): boolean {
  return enabled
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled || !sentry) return
  try {
    if (context) {
      sentry.withScope((scope: any) => {
        for (const [k, v] of Object.entries(context)) scope.setExtra(k, v)
        sentry.captureException(err)
      })
    } else {
      sentry.captureException(err)
    }
  } catch {
    /* never let telemetry crash a request */
  }
}

export function setUser(user: { id?: string; organizationId?: string } | null): void {
  if (!enabled || !sentry) return
  try {
    sentry.setUser(user ? { id: user.id, organizationId: user.organizationId } : null)
  } catch {
    /* ignore */
  }
}
