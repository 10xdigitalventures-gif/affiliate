import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApplicationsService } from '../applications/applications.service'
import { SettingsService } from '../settings/settings.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApplyDto } from '../applications/dto/apply.dto'

/**
 * Public-facing signup endpoints (no JWT required).
 * POST /v1/signup/:orgSlug — submit affiliate application
 * GET  /v1/signup/:orgSlug/status — check if signup is open + org name
 */
@Controller('signup')
export class SignupController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Check if affiliate signup is open for this org (public, no auth). */
  @Get(':orgSlug/status')
  async status(@Param('orgSlug') orgSlug: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } })
    if (!org) return { open: false, orgName: null }
    const s = (org.settings ?? {}) as Record<string, unknown>
    const b = (s.signupBranding ?? {}) as Record<string, unknown>
    const eb = (s.signupEmbedBranding ?? {}) as Record<string, unknown>
    const str = (v: unknown, fb: string | null) => (typeof v === 'string' ? v : fb)
    const strv = (v: unknown, fb: string) => (typeof v === 'string' && v ? v : fb)
    const branding = {
      headline: str(b.headline, null),
      subheadline: str(b.subheadline, null),
      imageUrl: str(b.imageUrl, null),
      accentColor: strv(b.accentColor, '#1B4DFF'),
      layout: b.layout === 'centered' ? 'centered' : 'split',
      buttonText: strv(b.buttonText, 'Apply now'),
    }
    // Embed inherits the page branding unless the tenant enabled a custom embed design.
    const embedBranding = {
      custom: eb.custom === true,
      headline: typeof eb.headline === 'string' ? eb.headline : branding.headline,
      subheadline: typeof eb.subheadline === 'string' ? eb.subheadline : branding.subheadline,
      imageUrl: typeof eb.imageUrl === 'string' ? eb.imageUrl : branding.imageUrl,
      accentColor: strv(eb.accentColor, branding.accentColor),
      layout: eb.layout === 'centered' ? 'centered' : eb.layout === 'split' ? 'split' : branding.layout,
      buttonText: strv(eb.buttonText, branding.buttonText),
    }
    return {
      open: s.signupEnabled !== false,
      autoApprove: s.autoApprove === true,
      orgName: org.name,
      orgSlug: org.slug,
      branding,
      embedBranding,
    }
  }

  /** Submit affiliate application (public, no auth). Spam protection: 3/min per IP. */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post(':orgSlug')
  @HttpCode(201)
  apply(@Param('orgSlug') orgSlug: string, @Body() dto: ApplyDto) {
    return this.applications.apply(orgSlug, dto)
  }
}
