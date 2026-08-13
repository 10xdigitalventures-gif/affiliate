import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ApiKeysService } from '../../apikeys/apikeys.service'

/**
 * ApiKeyGuard — alternative to JwtAuthGuard for machine-to-machine requests.
 *
 * The key is read from the `x-api-key` header ONLY.
 *
 * Accepting the key from a query string was removed deliberately: a URL is not
 * a safe place for a long-lived credential. Query strings are written to nginx
 * and load-balancer access logs, kept in browser history, and forwarded in the
 * `Referer` header to any third party the page links out to. A key leaked that
 * way grants full org-scoped API access until it is manually revoked.
 *
 * Attaches { organizationId, scopes, apiKeyId } to request.user.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name)

  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest()

    // Node gives an array when a header is repeated; take the first value.
    const header = req.headers?.['x-api-key']
    const raw = (Array.isArray(header) ? header[0] : header)?.trim()

    if (!raw) {
      // Callers still using the removed query param get a specific error rather
      // than a bare "API key required", so the migration is obvious.
      if (req.query?.apiKey || req.query?.api_key) {
        this.logger.warn(
          `API key supplied in the query string for ${req.method} ${req.path} — rejected. ` +
            'That key has been exposed in logs and should be revoked and reissued.',
        )
        throw new UnauthorizedException(
          'API keys must be sent in the x-api-key header, not the query string. ' +
            'The key you used has been exposed in server logs — revoke and reissue it.',
        )
      }
      throw new UnauthorizedException('API key required')
    }

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
