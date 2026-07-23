import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateBrandingDto } from './dto/branding.dto'

export interface Branding {
  companyName: string | null
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  accentColor: string
  loginHeadline: string | null
  supportEmail: string | null
  hidePlatformBranding: boolean
}

const DEFAULTS: Branding = {
  companyName: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#1B4DFF',
  accentColor: '#0A2540',
  loginHeadline: null,
  supportEmail: null,
  hidePlatformBranding: false,
}

/**
 * White-label branding. Stored inside Organization.settings.branding so no
 * extra table is needed. Feature-gated ("branding") at the controller level.
 */
@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  private extract(settings: unknown): Branding {
    const b = ((settings as any)?.branding ?? {}) as Partial<Branding>
    return { ...DEFAULTS, ...b }
  }

  async getForOrg(organizationId: string): Promise<Branding> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    if (!org) throw new NotFoundException('Organization not found')
    return this.extract(org.settings)
  }

  async update(organizationId: string, dto: UpdateBrandingDto): Promise<Branding> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    if (!org) throw new NotFoundException('Organization not found')
    const current = (org.settings ?? {}) as Record<string, unknown>
    const branding = { ...this.extract(org.settings), ...dto }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, branding } },
    })
    return branding
  }

  /**
   * Public: resolve branding for a branded login page, by custom hostname or
   * by org slug. Returns null when nothing matches so callers fall back to the
   * platform default theme.
   */
  async resolvePublic(params: { hostname?: string; slug?: string }): Promise<
    ({ organizationId: string; slug: string } & Branding) | null
  > {
    let org: { id: string; slug: string; settings: unknown } | null = null

    if (params.hostname) {
      const domain = await this.prisma.domain.findFirst({
        where: { hostname: params.hostname.toLowerCase(), status: 'active' },
        include: { organization: { select: { id: true, slug: true, settings: true } } },
      })
      if (domain) org = domain.organization
    }
    if (!org && params.slug) {
      org = await this.prisma.organization.findUnique({
        where: { slug: params.slug.toLowerCase() },
        select: { id: true, slug: true, settings: true },
      })
    }
    if (!org) return null
    return { organizationId: org.id, slug: org.slug, ...this.extract(org.settings) }
  }
}
