import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import { AuditService } from './audit.service'

/**
 * Records a body-free audit envelope for every authenticated API mutation.
 * Domain services still write richer financial/team audit events; this safety
 * net covers settings, API keys, domains and future endpoints without ever
 * copying passwords, tokens, payout destinations or gateway secrets.
 */
@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<any>()
    const response = context.switchToHttp().getResponse<any>()
    const method = String(request.method || '').toUpperCase()
    const user = request.user as { sub?: string; organizationId?: string; apiKeyId?: string } | undefined
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !user?.organizationId) {
      return next.handle()
    }

    const path = String(request.originalUrl || request.url || '').split('?')[0].slice(0, 500)
    const resourceId = request.params?.id || request.params?.orgId || request.params?.storeId
    const userId = user.sub && !user.sub.startsWith('apikey:') ? user.sub : null
    const base = {
      organizationId: user.organizationId,
      userId,
      action: `api.${method.toLowerCase()}`,
      resourceType: 'api_mutation',
      resourceId: resourceId ? String(resourceId).slice(0, 200) : undefined,
      ipAddress: typeof request.ip === 'string' ? request.ip.slice(0, 100) : undefined,
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.log({
            ...base,
            newValue: {
              path,
              outcome: 'success',
              statusCode: Number(response.statusCode) || 200,
              requestId: response.getHeader?.('x-request-id') || undefined,
              apiKeyId: user.apiKeyId || undefined,
            },
          }).catch(() => undefined)
        },
        error: (error: { status?: number; statusCode?: number }) => {
          void this.audit.log({
            ...base,
            newValue: {
              path,
              outcome: 'failed',
              statusCode: Number(error?.status || error?.statusCode) || 500,
              requestId: response.getHeader?.('x-request-id') || undefined,
              apiKeyId: user.apiKeyId || undefined,
            },
          }).catch(() => undefined)
        },
      }),
    )
  }
}
