import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { DomainsService } from '../domains/domains.service'
import { CreateLinkDto } from './dto/create-link.dto'
import { UpdateLinkDto } from './dto/update-link.dto'

export type ListLinksParams = {
  affiliateId?: string
  storeId?: string
  campaignId?: string
  search?: string
}

const AFFILIATE_SELECT = { id: true, affiliateCode: true } as const
const CAMPAIGN_SELECT = { id: true, name: true } as const

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domains: DomainsService,
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
    return (process.env.TRACKING_BASE_URL || process.env.API_URL || 'http://localhost:4000/v1').replace(/\/$/, '')
  }

  /** Prefer the tenant's verified first-party tracking domain; else the platform default. */
  private async resolveTrackingBase(organizationId: string) {
    const custom = await this.domains.trackingBaseUrl(organizationId).catch(() => null)
    return custom ?? this.envTrackingBase()
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

  async stats(organizationId: string) {
    const where = { affiliate: { organizationId } }
    const [total, agg] = await this.prisma.$transaction([
      this.prisma.affiliateLink.count({ where }),
      this.prisma.affiliateLink.aggregate({ where, _sum: { clicksCount: true } }),
    ])
    return { total, totalClicks: Number(agg._sum.clicksCount ?? 0) }
  }
}
