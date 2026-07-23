import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { DomainsService } from '../domains/domains.service'
import { CreateLinkDto } from './dto/create-link.dto'
import { UpdateLinkDto } from './dto/update-link.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

export type ListLinksParams = {
  affiliateId?: string
  storeId?: string
  campaignId?: string
  search?: string
}

export type CreateAffiliateLinkInput = {
  destinationUrl: string
  shortCode?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
}

const AFFILIATE_SELECT = { id: true, affiliateCode: true } as const
const CAMPAIGN_SELECT = { id: true, name: true } as const

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domains: DomainsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private shortCode() {
    return randomBytes(5).toString('base64url').slice(0, 7)
  }

  private async uniqueShortCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.shortCode()
      const exists = await this.prisma.affiliateLink.findUnique({ where: { shortCode: code } })
      if (!exists) return code
    }
    return this.shortCode() + Date.now().toString(36).slice(-3)
  }

  private envTrackingBase() {
    return (process.env.TRACKING_BASE_URL || process.env.API_PUBLIC_URL || 'https://affiliate.mentoringhub.online/v1').replace(/\/$/, '')
  }

  /** Prefer the tenant's verified first-party tracking domain; else the platform default. */
  private async resolveTrackingBase(organizationId: string) {
    const custom = await this.domains.trackingBaseUrl(organizationId).catch(() => null)
    return custom ?? this.envTrackingBase()
  }

  private async assertTargets(organizationId: string, storeId?: string | null, campaignId?: string | null) {
    if (storeId) {
      const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId }, select: { id: true } })
      if (!store) throw new NotFoundException('Store not found')
    }
    if (campaignId) {
      const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, organizationId }, select: { id: true } })
      if (!campaign) throw new NotFoundException('Campaign not found')
    }
  }

  private hostname(value: string) {
    try {
      const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  private destinationFor(input: CreateAffiliateLinkInput) {
    const url = new URL(input.destinationUrl)
    const utm = {
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
      utm_content: input.utmContent,
      utm_term: input.utmTerm,
    }
    for (const [key, value] of Object.entries(utm)) {
      const trimmed = value?.trim()
      if (trimmed) url.searchParams.set(key, trimmed)
    }
    return url.toString()
  }

  /** Attach a full tracking short URL and coerce the BigInt clicksCount to a number. */
  private decorate<T extends { shortCode: string; clicksCount?: bigint | number }>(link: T, base: string) {
    return {
      ...link,
      clicksCount: link.clicksCount != null ? Number(link.clicksCount) : 0,
      shortUrl: `${base}/track/r/${link.shortCode}`,
    }
  }

  async create(organizationId: string, dto: CreateLinkDto) {
    const affiliate = await this.prisma.affiliate.findFirst({ where: { id: dto.affiliateId, organizationId } })
    if (!affiliate) throw new NotFoundException('Affiliate not found')
    await this.assertTargets(organizationId, dto.storeId, dto.campaignId)

    let shortCode = dto.shortCode?.trim()
    if (shortCode) {
      const exists = await this.prisma.affiliateLink.findUnique({ where: { shortCode } })
      if (exists) throw new ConflictException('Short code already in use')
    } else {
      shortCode = await this.uniqueShortCode()
    }

    const link = await this.prisma.affiliateLink.create({
      data: {
        affiliateId: affiliate.id,
        storeId: dto.storeId ?? null,
        campaignId: dto.campaignId ?? null,
        destinationUrl: dto.destinationUrl,
        shortCode,
      },
    })
    const base = await this.resolveTrackingBase(organizationId)
    return this.decorate(link, base)
  }

  /**
   * Affiliate self-service link creation. Ownership comes exclusively from the
   * authenticated JWT; callers cannot choose another affiliate or tenant.
   * Destinations are limited to a connected store owned by that tenant so the
   * public redirect cannot be abused as an open phishing redirect.
   */
  async createForAffiliate(
    organizationId: string,
    affiliateId: string,
    input: CreateAffiliateLinkInput,
  ) {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: { id: affiliateId, organizationId, status: 'approved' },
      select: { id: true },
    })
    if (!affiliate) throw new ForbiddenException('Affiliate portal access is not active')

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    const settings = (organization?.settings ?? {}) as Record<string, unknown>
    if (settings.allowAffiliateLinkCreation === false) {
      throw new ForbiddenException('Affiliate link creation is disabled by this workspace')
    }

    const linkLimit = await this.entitlements.getLimit(organizationId, 'trackingLinksPerAffiliate')
    if (linkLimit >= 0) {
      const currentCount = await this.prisma.affiliateLink.count({ where: { affiliateId } })
      if (currentCount >= linkLimit) {
        throw new ForbiddenException(`Your plan allows ${linkLimit} tracking link(s) per affiliate`)
      }
    }

    const destination = this.destinationFor(input)
    const destinationHost = this.hostname(destination)
    const stores = await this.prisma.store.findMany({
      where: { organizationId, status: 'connected' },
      select: { id: true, domain: true },
    })
    const store = stores.find((candidate) => {
      const storeHost = this.hostname(candidate.domain)
      return Boolean(storeHost) && (destinationHost === storeHost || destinationHost.endsWith(`.${storeHost}`))
    })
    if (!store) {
      throw new BadRequestException('Destination must belong to a connected store in this workspace')
    }

    return this.create(organizationId, {
      affiliateId,
      storeId: store.id,
      destinationUrl: destination,
      shortCode: input.shortCode?.trim() || undefined,
    })
  }

  async list(organizationId: string, params: ListLinksParams = {}) {
    const where: any = { affiliate: { organizationId } }
    if (params.affiliateId) where.affiliateId = params.affiliateId
    if (params.storeId) where.storeId = params.storeId
    if (params.campaignId) where.campaignId = params.campaignId
    if (params.search) {
      where.OR = [
        { destinationUrl: { contains: params.search, mode: 'insensitive' } },
        { shortCode: { contains: params.search, mode: 'insensitive' } },
      ]
    }
    const links = await this.prisma.affiliateLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { affiliate: { select: AFFILIATE_SELECT }, campaign: { select: CAMPAIGN_SELECT } },
    })
    const base = await this.resolveTrackingBase(organizationId)
    return links.map((l) => this.decorate(l, base))
  }

  async get(organizationId: string, id: string) {
    const link = await this.prisma.affiliateLink.findFirst({
      where: { id, affiliate: { organizationId } },
      include: { affiliate: { select: AFFILIATE_SELECT }, campaign: { select: CAMPAIGN_SELECT } },
    })
    if (!link) throw new NotFoundException('Link not found')
    const base = await this.resolveTrackingBase(organizationId)
    return this.decorate(link, base)
  }

  async listForAffiliate(organizationId: string, affiliateId: string) {
    const affiliate = await this.prisma.affiliate.findFirst({ where: { id: affiliateId, organizationId } })
    if (!affiliate) throw new NotFoundException('Affiliate not found')
    const links = await this.prisma.affiliateLink.findMany({
      where: { affiliateId },
      orderBy: { createdAt: 'desc' },
      include: { campaign: { select: CAMPAIGN_SELECT } },
    })
    const base = await this.resolveTrackingBase(organizationId)
    return links.map((l) => this.decorate(l, base))
  }

  async update(organizationId: string, id: string, dto: UpdateLinkDto) {
    const link = await this.prisma.affiliateLink.findFirst({ where: { id, affiliate: { organizationId } } })
    if (!link) throw new NotFoundException('Link not found')
    await this.assertTargets(organizationId, dto.storeId, dto.campaignId)
    const data: any = {}
    if (dto.destinationUrl !== undefined) data.destinationUrl = dto.destinationUrl
    if ('storeId' in dto) data.storeId = dto.storeId || null
    if ('campaignId' in dto) data.campaignId = dto.campaignId || null
    const updated = await this.prisma.affiliateLink.update({ where: { id }, data })
    const base = await this.resolveTrackingBase(organizationId)
    return this.decorate(updated, base)
  }

  async remove(organizationId: string, id: string) {
    const link = await this.prisma.affiliateLink.findFirst({ where: { id, affiliate: { organizationId } } })
    if (!link) throw new NotFoundException('Link not found')
    const clicks = await this.prisma.click.count({ where: { affiliateLinkId: id } })
    if (clicks > 0) {
      throw new ConflictException('Cannot delete a link that already has recorded clicks')
    }
    await this.prisma.affiliateLink.delete({ where: { id } })
    return { id, deleted: true }
  }

  async removeForAffiliate(organizationId: string, affiliateId: string, id: string) {
    const link = await this.prisma.affiliateLink.findFirst({
      where: { id, affiliateId, affiliate: { organizationId } },
    })
    if (!link) throw new NotFoundException('Link not found')
    const clicks = await this.prisma.click.count({ where: { affiliateLinkId: id } })
    if (clicks > 0) throw new ConflictException('A link with recorded clicks cannot be deleted')
    await this.prisma.affiliateLink.delete({ where: { id } })
    return { id, deleted: true }
  }

  async stats(organizationId: string) {
    const where = { affiliate: { organizationId } }
    const [total, agg] = await this.prisma.$transaction([
      this.prisma.affiliateLink.count({ where }),
      this.prisma.affiliateLink.aggregate({ where, _sum: { clicksCount: true } }),
    ])
    return { total, totalClicks: Number(agg._sum.clicksCount ?? 0) }
  }
}
