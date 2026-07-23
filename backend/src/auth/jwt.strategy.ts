import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { PrismaService } from '../prisma/prisma.service'
import { ConfigService } from '@nestjs/config'

export interface JwtPayload {
  sub: string
  organizationId: string
  permissions: string[]
  affiliateId?: string | null
  isSuperAdmin?: boolean
}

function cookieExtractor(req: { headers?: { cookie?: string } } | undefined): string | null {
  const raw = req?.headers?.cookie
  if (!raw) return null
  for (const item of raw.split(';')) {
    const [key, ...value] = item.trim().split('=')
    if (key === 'affiliate_access') return decodeURIComponent(value.join('='))
  }
  return null
}

const extractAuthorizationBearer = ExtractJwt.fromAuthHeaderAsBearerToken()
function bearerExtractor(req: any): string | null {
  // API-key authentication is the production machine-to-machine mechanism.
  // When bearer mode is disabled, do not merely hide tokens from login
  // responses: reject Authorization bearer credentials at the extractor too.
  const enabled = process.env.NODE_ENV !== 'production' || process.env.ALLOW_BEARER_AUTH === 'true'
  return enabled ? extractAuthorizationBearer(req) : null
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, bearerExtractor]),
      ignoreExpiration: false,
      // Production is rejected earlier if the secret is missing. This explicit
      // development value keeps module-level tests and local scaffolding clear.
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') || 'development-only-missing-secret',
    })
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        status: true,
        organizationId: true,
        isSuperAdmin: true,
        organization: { select: { status: true } },
        affiliate: { select: { id: true, status: true } },
        roles: {
          select: {
            role: {
              select: {
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    })
    if (!user || user.status !== 'active' || user.organizationId !== payload.organizationId) {
      throw new UnauthorizedException('Session is no longer valid')
    }
    if (user.organization.status === 'suspended' && !user.isSuperAdmin) {
      throw new UnauthorizedException('Workspace suspended')
    }
    const permissions = [
      ...new Set(user.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.key))),
    ]
    // Reload the affiliate relationship on every request as well. A signed JWT
    // may outlive an affiliate suspension/re-link and must never retain stale
    // portal access.
    return {
      ...payload,
      permissions,
      affiliateId: user.affiliate?.status === 'approved' ? user.affiliate.id : null,
      isSuperAdmin: user.isSuperAdmin,
    }
  }
}
