import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ApiKeysService } from '../../apikeys/apikeys.service'

/**
 * ApiKeyGuard — alternative to JwtAuthGuard for machine-to-machine requests.
 * Reads the key only from the `x-api-key` header. Query-string credentials are
 * deliberately rejected because URLs are routinely retained in browser,
 * reverse-proxy and observability logs.
 * Attaches { organizationId, scopes, apiKeyId } to request.user.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest()
    const header = req.headers['x-api-key']
    const raw = Array.isArray(header) ? header[0] : header

    if (!raw) throw new UnauthorizedException('API key required')

    const record = await this.apiKeys.verify(raw)
    req.user = {
      organizationId: record.organizationId,
      scopes: record.scopes,
      apiKeyId: record.id,
      // Minimal JwtPayload shape for downstream compatibility
      sub: `apikey:${record.id}`,
      permissions: record.scopes,
    }
    return true
  }
}
