import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { captureException } from './sentry'

/**
 * Global exception filter:
 * - Returns a consistent JSON error envelope with the request id.
 * - Logs 5xx errors with the request id for correlation.
 * - Reports unexpected (5xx / non-HttpException) errors to Sentry.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse()
    const req = ctx.getRequest()
    const requestId: string | undefined = req?.id

    const isHttp = exception instanceof HttpException
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    let message: unknown = 'Internal server error'
    if (isHttp) {
      const body = exception.getResponse()
      message = typeof body === 'string' ? body : (body as any).message ?? body
    }

    // Report + log anything that is a real server-side failure.
    if (status >= 500) {
      this.logger.error(
        `[${requestId ?? '-'}] ${req?.method} ${req?.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      )
      captureException(exception, {
        requestId,
        method: req?.method,
        url: req?.url,
        organizationId: req?.user?.organizationId,
      })
    }

    res.status(status).json({
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: req?.url,
    })
  }
}
