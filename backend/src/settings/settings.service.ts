import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SignupSettingsDto } from './dto/signup-settings.dto'
import { SubAffiliateSettingsDto } from './dto/sub-affiliate-settings.dto'
import { AttributionSettingsDto } from './dto/attribution-settings.dto'
import { NotificationSettingsDto } from './dto/notification-settings.dto'
import { CommissionChannelSettingsDto } from './dto/commission-channel-settings.dto'
import { CustomerTypeSettingsDto } from './dto/customer-type-settings.dto'
import { SsoSettingsDto } from './dto/sso-settings.dto'
import { AttributionService, AttributionSettings } from '../attribution/attribution.service'

export interface NotificationSettings {
  inAppEnabled: boolean
  emailEnabled: boolean
}

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  inAppEnabled: true,
  emailEnabled: true,
}

export interface CommissionChannelSettings {
  enabled: boolean
  codeOrganicRate: number | null
  codePaidRate: number | null
  linkOrganicRate: number | null
  linkPaidRate: number | null
}

const COMMISSION_CHANNEL_DEFAULTS: CommissionChannelSettings = {
  enabled: false,
  codeOrganicRate: 10,
  codePaidRate: 5,
  linkOrganicRate: null,
  linkPaidRate: null,
}

export interface CustomerTypeSettings {
  enabled: boolean
  newCustomerRate: number | null
  returningCustomerRate: number | null
}

const CUSTOMER_TYPE_DEFAULTS: CustomerTypeSettings = {
  enabled: false,
  newCustomerRate: 15,
  returningCustomerRate: 5,
}

export interface SignupBranding {
  headline: string | null
  subheadline: string | null
  imageUrl: string | null
  accentColor: string
  layout: 'split' | 'centered'
  buttonText: string
}

// Embed-specific branding: same fields as SignupBranding, plus a `custom` flag.
// When custom is false the embed inherits the hosted-page branding.
export interface EmbedBranding extends SignupBranding {
  custom: boolean
}

export interface SignupSettings {
  signupEnabled: boolean
  autoApprove: boolean
  requireWebsite: boolean
  branding: SignupBranding
  embedBranding: EmbedBranding
  slug: string
  orgName: string
}

export interface SubAffiliateSettings {
  subAffiliateEnabled: boolean
  subAffiliateRate: number
  subAffiliateMaxDepth: number
  subAffiliateDecay: number
}

const BRANDING_DEFAULTS: SignupBranding = {
  headline: null,
  subheadline: null,
  imageUrl: null,
  accentColor: '#1B4DFF',
  layout: 'split',
  buttonText: 'Apply now',
}

const EMBED_BRANDING_DEFAULTS: EmbedBranding = {
  ...BRANDING_DEFAULTS,
  custom: false,
}

const DEFAULTS = {
  signupEnabled: true,
  autoApprove: false,
  requireWebsite: false,
}

const SUB_AFFILIATE_DEFAULTS: SubAffiliateSettings = {
  subAffiliateEnabled: false,
  subAffiliateRate: 10,
  subAffiliateMaxDepth: 1,
  subAffiliateDecay: 1,
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
  ) {}

  private async getOrg(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    if (!org) throw new NotFoundException('Organization not found')
    return org
  }

  async getSignupSettings(organizationId: string): Promise<SignupSettings> {
    const org = await this.getOrg(organizationId)
    const stored = (org.settings ?? {}) as Record<string, unknown>
    const b = (stored.signupBranding ?? {}) as Record<string, unknown>
    const eb = (stored.signupEmbedBranding ?? {}) as Record<string, unknown>
    const branding: SignupBranding = {
      headline: typeof b.headline === 'string' ? b.headline : BRANDING_DEFAULTS.headline,
      subheadline: typeof b.subheadline === 'string' ? b.subheadline : BRANDING_DEFAULTS.subheadline,
      imageUrl: typeof b.imageUrl === 'string' ? b.imageUrl : BRANDING_DEFAULTS.imageUrl,
      accentColor: typeof b.accentColor === 'string' && b.accentColor ? b.accentColor : BRANDING_DEFAULTS.accentColor,
      layout: b.layout === 'centered' ? 'centered' : 'split',
      buttonText: typeof b.buttonText === 'string' && b.buttonText ? b.buttonText : BRANDING_DEFAULTS.buttonText,
    }
    // The embed falls back to the page branding for any field it doesn't override,
    // so a tenant can restyle only what they want while reusing the same fields.
    const embedBranding: EmbedBranding = {
      custom: eb.custom === true,
      headline: typeof eb.headline === 'string' ? eb.headline : branding.headline,
      subheadline: typeof eb.subheadline === 'string' ? eb.subheadline : branding.subheadline,
      imageUrl: typeof eb.imageUrl === 'string' ? eb.imageUrl : branding.imageUrl,
      accentColor: typeof eb.accentColor === 'string' && eb.accentColor ? eb.accentColor : branding.accentColor,
      layout: eb.layout === 'centered' ? 'centered' : eb.layout === 'split' ? 'split' : branding.layout,
      buttonText: typeof eb.buttonText === 'string' && eb.buttonText ? eb.buttonText : branding.buttonText,
    }
    return {
      signupEnabled: stored.signupEnabled !== undefined ? Boolean(stored.signupEnabled) : DEFAULTS.signupEnabled,
      autoApprove: stored.autoApprove !== undefined ? Boolean(stored.autoApprove) : DEFAULTS.autoApprove,
      requireWebsite: stored.requireWebsite !== undefined ? Boolean(stored.requireWebsite) : DEFAULTS.requireWebsite,
      branding,
      embedBranding,
      slug: org.slug,
      orgName: org.name,
    }
  }

  async updateSignupSettings(organizationId: string, dto: SignupSettingsDto): Promise<SignupSettings> {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prevBranding = (current.signupBranding ?? {}) as Record<string, unknown>
    const signupBranding = {
      ...prevBranding,
      ...(dto.headline !== undefined ? { headline: dto.headline } : {}),
      ...(dto.subheadline !== undefined ? { subheadline: dto.subheadline } : {}),
      ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor } : {}),
      ...(dto.layout !== undefined ? { layout: dto.layout } : {}),
      ...(dto.buttonText !== undefined ? { buttonText: dto.buttonText } : {}),
    }
    const prevEmbed = (current.signupEmbedBranding ?? {}) as Record<string, unknown>
    const signupEmbedBranding = {
      ...prevEmbed,
      ...(dto.embedCustom !== undefined ? { custom: dto.embedCustom } : {}),
      ...(dto.embedHeadline !== undefined ? { headline: dto.embedHeadline } : {}),
      ...(dto.embedSubheadline !== undefined ? { subheadline: dto.embedSubheadline } : {}),
      ...(dto.embedImageUrl !== undefined ? { imageUrl: dto.embedImageUrl } : {}),
      ...(dto.embedAccentColor !== undefined ? { accentColor: dto.embedAccentColor } : {}),
      ...(dto.embedLayout !== undefined ? { layout: dto.embedLayout } : {}),
      ...(dto.embedButtonText !== undefined ? { buttonText: dto.embedButtonText } : {}),
    }
    const updated = {
      ...current,
      signupEnabled: dto.signupEnabled,
      autoApprove: dto.autoApprove,
      ...(dto.requireWebsite !== undefined ? { requireWebsite: dto.requireWebsite } : {}),
      signupBranding,
      signupEmbedBranding,
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { settings: updated } })
    return this.getSignupSettings(organizationId)
  }

  async getSubAffiliateSettings(organizationId: string): Promise<SubAffiliateSettings> {
    const org = await this.getOrg(organizationId)
    const s = (org.settings ?? {}) as Record<string, unknown>
    return {
      subAffiliateEnabled: s.subAffiliateEnabled === true,
      subAffiliateRate: typeof s.subAffiliateRate === 'number' ? s.subAffiliateRate : SUB_AFFILIATE_DEFAULTS.subAffiliateRate,
      subAffiliateMaxDepth: typeof s.subAffiliateMaxDepth === 'number' ? s.subAffiliateMaxDepth : SUB_AFFILIATE_DEFAULTS.subAffiliateMaxDepth,
      subAffiliateDecay: typeof s.subAffiliateDecay === 'number' ? s.subAffiliateDecay : SUB_AFFILIATE_DEFAULTS.subAffiliateDecay,
    }
  }

  async updateSubAffiliateSettings(organizationId: string, dto: SubAffiliateSettingsDto): Promise<SubAffiliateSettings> {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const updated = {
      ...current,
      subAffiliateEnabled: dto.subAffiliateEnabled,
      ...(dto.subAffiliateRate !== undefined ? { subAffiliateRate: dto.subAffiliateRate } : {}),
      ...(dto.subAffiliateMaxDepth !== undefined ? { subAffiliateMaxDepth: dto.subAffiliateMaxDepth } : {}),
      ...(dto.subAffiliateDecay !== undefined ? { subAffiliateDecay: dto.subAffiliateDecay } : {}),
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { settings: updated } })
    return this.getSubAffiliateSettings(organizationId)
  }

  async getNotificationSettings(organizationId: string): Promise<NotificationSettings> {
    const org = await this.getOrg(organizationId)
    const s = ((org.settings ?? {}) as Record<string, unknown>).notifications as Record<string, unknown> | undefined
    return {
      inAppEnabled: s?.inAppEnabled !== undefined ? Boolean(s.inAppEnabled) : NOTIFICATION_DEFAULTS.inAppEnabled,
      emailEnabled: s?.emailEnabled !== undefined ? Boolean(s.emailEnabled) : NOTIFICATION_DEFAULTS.emailEnabled,
    }
  }

  async updateNotificationSettings(organizationId: string, dto: NotificationSettingsDto): Promise<NotificationSettings> {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const updated = {
      ...current,
      notifications: { inAppEnabled: dto.inAppEnabled, emailEnabled: dto.emailEnabled },
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { settings: updated } })
    return this.getNotificationSettings(organizationId)
  }

  async getCommissionChannelSettings(organizationId: string): Promise<CommissionChannelSettings> {
    const org = await this.getOrg(organizationId)
    const s = ((org.settings ?? {}) as Record<string, unknown>).commissionChannel as Record<string, unknown> | undefined
    const num = (v: unknown, d: number | null) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : d)
    return {
      enabled: s?.enabled === true,
      codeOrganicRate: num(s?.codeOrganicRate, COMMISSION_CHANNEL_DEFAULTS.codeOrganicRate),
      codePaidRate: num(s?.codePaidRate, COMMISSION_CHANNEL_DEFAULTS.codePaidRate),
      linkOrganicRate: num(s?.linkOrganicRate, COMMISSION_CHANNEL_DEFAULTS.linkOrganicRate),
      linkPaidRate: num(s?.linkPaidRate, COMMISSION_CHANNEL_DEFAULTS.linkPaidRate),
    }
  }

  async updateCommissionChannelSettings(
    organizationId: string,
    dto: CommissionChannelSettingsDto,
  ): Promise<CommissionChannelSettings> {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prev = (current.commissionChannel ?? {}) as Record<string, unknown>
    const commissionChannel = {
      ...prev,
      enabled: dto.enabled,
      ...(dto.codeOrganicRate !== undefined ? { codeOrganicRate: dto.codeOrganicRate } : {}),
      ...(dto.codePaidRate !== undefined ? { codePaidRate: dto.codePaidRate } : {}),
      ...(dto.linkOrganicRate !== undefined ? { linkOrganicRate: dto.linkOrganicRate } : {}),
      ...(dto.linkPaidRate !== undefined ? { linkPaidRate: dto.linkPaidRate } : {}),
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, commissionChannel } },
    })
    return this.getCommissionChannelSettings(organizationId)
  }

  async getCustomerTypeSettings(organizationId: string): Promise<CustomerTypeSettings> {
    const org = await this.getOrg(organizationId)
    const s = ((org.settings ?? {}) as Record<string, unknown>).customerType as Record<string, unknown> | undefined
    const num = (v: unknown, d: number | null) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : d)
    return {
      enabled: s?.enabled === true,
      newCustomerRate: num(s?.newCustomerRate, CUSTOMER_TYPE_DEFAULTS.newCustomerRate),
      returningCustomerRate: num(s?.returningCustomerRate, CUSTOMER_TYPE_DEFAULTS.returningCustomerRate),
    }
  }

  async updateCustomerTypeSettings(
    organizationId: string,
    dto: CustomerTypeSettingsDto,
  ): Promise<CustomerTypeSettings> {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prev = (current.customerType ?? {}) as Record<string, unknown>
    const customerType = {
      ...prev,
      enabled: dto.enabled,
      ...(dto.newCustomerRate !== undefined ? { newCustomerRate: dto.newCustomerRate } : {}),
      ...(dto.returningCustomerRate !== undefined ? { returningCustomerRate: dto.returningCustomerRate } : {}),
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, customerType } },
    })
    return this.getCustomerTypeSettings(organizationId)
  }

  // SSO config. The client secret is write-only: we return whether one is set,
  // never the value itself.
  async getSsoSettings(organizationId: string) {
    const org = await this.getOrg(organizationId)
    const s = ((org.settings ?? {}) as Record<string, unknown>).sso as Record<string, unknown> | undefined
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      enabled: s?.enabled === true,
      provider: str(s?.provider) || 'oidc',
      clientId: str(s?.clientId),
      hasClientSecret: typeof s?.clientSecret === 'string' && s.clientSecret.length > 0,
      authorizationUrl: str(s?.authorizationUrl),
      tokenUrl: str(s?.tokenUrl),
      userinfoUrl: str(s?.userinfoUrl),
      scopes: str(s?.scopes) || 'openid email profile',
      allowedDomains: Array.isArray(s?.allowedDomains)
        ? (s!.allowedDomains as unknown[]).filter((d): d is string => typeof d === 'string')
        : [],
      autoProvision: s?.autoProvision === true,
      defaultRoleId: typeof s?.defaultRoleId === 'string' ? s.defaultRoleId : null,
      callbackUrl:
        process.env.SSO_CALLBACK_URL ||
        `${process.env.API_PUBLIC_URL || 'http://localhost:4000/v1'}/auth/sso/callback`,
    }
  }

  async updateSsoSettings(organizationId: string, dto: SsoSettingsDto) {
    const org = await this.getOrg(organizationId)
    const current = (org.settings ?? {}) as Record<string, unknown>
    const prev = (current.sso ?? {}) as Record<string, unknown>
    const sso: Record<string, unknown> = {
      ...prev,
      enabled: dto.enabled,
      ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
      ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
      // Only overwrite the secret when a non-empty value is provided.
      ...(dto.clientSecret ? { clientSecret: dto.clientSecret } : {}),
      ...(dto.authorizationUrl !== undefined ? { authorizationUrl: dto.authorizationUrl } : {}),
      ...(dto.tokenUrl !== undefined ? { tokenUrl: dto.tokenUrl } : {}),
      ...(dto.userinfoUrl !== undefined ? { userinfoUrl: dto.userinfoUrl } : {}),
      ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
      ...(dto.allowedDomains !== undefined ? { allowedDomains: dto.allowedDomains } : {}),
      ...(dto.autoProvision !== undefined ? { autoProvision: dto.autoProvision } : {}),
      ...(dto.defaultRoleId !== undefined ? { defaultRoleId: dto.defaultRoleId } : {}),
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, sso } as any },
    })
    return this.getSsoSettings(organizationId)
  }

  getAttributionSettings(organizationId: string): Promise<AttributionSettings> {
    return this.attribution.getSettings(organizationId)
  }

  updateAttributionSettings(organizationId: string, dto: AttributionSettingsDto): Promise<AttributionSettings> {
    return this.attribution.updateSettings(organizationId, dto)
  }
}
