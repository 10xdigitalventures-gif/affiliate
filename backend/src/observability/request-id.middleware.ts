import { Injectable, NestMiddleware } from '@nestjs/common'
import { randomUUID } from 'crypto'

/**
 * Attaches a stable request id to every request/response.
 * Honours an inbound `x-request-id` (from an upstream proxy/gateway) or mints one.
 * The id is echoed in the response header and used by the logger + error filter
 * so a single request can be traced end-to-end.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const incoming = req.headers['x-request-id']
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID()
    req.id = id
    res.setHeader('x-request-id', id)
    next()
  }
}
