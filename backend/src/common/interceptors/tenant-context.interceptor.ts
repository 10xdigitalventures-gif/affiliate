import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { runWithTenant } from '../../prisma/tenant-context'

/**
 * Puts the authenticated user's organization into AsyncLocalStorage so the
 * Prisma tenant-scoping middleware can narrow every query for this request.
 *
 * Runs as an interceptor rather than middleware because middleware executes
 * before the guards, when `req.user` does not exist yet.
 *
 * Requests with no authenticated user (login, webhooks, health checks) simply
 * run with no context; how those are treated is governed by TENANT_SCOPE_MODE.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle()

    const req = ctx.switchToHttp().getRequest()
    const organizationId: string | undefined = req?.user?.organizationId
    if (!organizationId) return next.handle()

    const isSuperAdmin = req.user?.isSuperAdmin === true

    // Subscribe INSIDE runWithTenant: next.handle() is deferred, so the route
    // handler only executes on subscription. Subscribing outside would run it
    // with an empty context.
    return new Observable((subscriber) => {
      let teardown: { unsubscribe(): void } | undefined
      runWithTenant({ organizationId, isSuperAdmin }, () => {
        teardown = next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        })
      })
      return () => teardown?.unsubscribe()
    })
  }
}
