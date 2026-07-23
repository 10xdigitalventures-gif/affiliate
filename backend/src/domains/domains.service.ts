import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { promises as dns } from 'dns'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AddDomainDto } from './dto/domain.dto'

/** The CNAME target tenants point their domain at. Override via env in prod. */
const CNAME_TARGET = process.env.CUSTOM_DOMAIN_TARGET || 'ingress.affiliate-platform.app'

/**
 * Custom (white-label) login domains. A tenant adds a hostname, receives a
 * TXT verification token + a CNAME target, then we confirm ownership by
 * reading the DNS TXT record. Feature-gated ("customDomain").
 */
@Injectable()
export class DomainsService {
  constructor(private readonly prisma: PrismaService) {}

  private instructions(hostname: string, token: string) {
    return {
      cname: { host: hostname, target: CNAME_TARGET },
      txt: { host: `_affiliate-verify.${hostname}`, value: token },
    }
  }

  async list(organizationId: string) {
    const domains = await this.prisma.domain.findMany({
      where: { organizationId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })
    return domains.map((d) => ({ ...d, instructions: this.instructions(d.hostname, d.verificationToken) }))
  }

  async add(organizationId: string, dto: AddDomainDto) {
    const hostname = dto.hostname.toLowerCase()
    const existing = await this.prisma.domain.findUnique({ where: { hostname } })
    if (existing) throw new BadRequestException('This domain is already registered')
    const token = `aff-verify-${randomBytes(16).toString('hex')}`
    const domain = await this.prisma.domain.create({
      data: { organizationId, hostname, verificationToken: token, status: 'pending', purpose: dto.purpose ?? 'login' },
    })
    return { ...domain, instructions: this.instructions(hostname, token) }
  }

  /**
   * Effective first-party tracking base URL for an org: the active tracking
   * domain (primary first) served over the API prefix, or null when the tenant
   * has not set one up (callers then fall back to the platform default).
   */
  async trackingBaseUrl(organizationId: string): Promise<string | null> {
    const domain = await this.prisma.domain.findFirst({
      where: { organizationId, purpose: 'tracking', status: 'active' },
      orderBy: [{ isPrimary: 'desc' }, { verifiedAt: 'desc' }],
    })
    if (!domain) return null
    const prefix = (process.env.API_PREFIX || 'v1').replace(/^\/+|\/+$/g, '')
    return 'https://' + domain.hostname + '/' + prefix
  }

  private async ownedDomain(organizationId: string, id: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id, organizationId } })
    if (!domain) throw new NotFoundException('Domain not found')
    return domain
  }

  /** Confirm DNS ownership by matching the TXT record; then activate the domain. */
  async verify(organizationId: string, id: string) {
    const domain = await this.ownedDomain(organizationId, id)
    await this.prisma.domain.update({ where: { id }, data: { status: 'verifying', lastCheckedAt: new Date() } })
    let records: string[][] = []
    try {
      records = await dns.resolveTxt(`_affiliate-verify.${domain.hostname}`)
    } catch {
      await this.prisma.domain.update({ where: { id }, data: { status: 'failed' } })
      throw new BadRequestException('Could not read the verification TXT record yet. DNS may still be propagating.')
    }
    const flat = records.map((r) => r.join(''))
    if (!flat.includes(domain.verificationToken)) {
      await this.prisma.domain.update({ where: { id }, data: { status: 'failed' } })
      throw new BadRequestException('Verification token not found in DNS TXT record.')
    }
    return this.prisma.domain.update({
      where: { id },
      data: { status: 'active', verifiedAt: new Date() },
    })
  }

  async setPrimary(organizationId: string, id: string) {
    const domain = await this.ownedDomain(organizationId, id)
    if (domain.status !== 'active') throw new BadRequestException('Only a verified domain can be made primary')
    // Primary is scoped per purpose (one primary login domain AND one primary tracking domain).
    await this.prisma.$transaction([
      this.prisma.domain.updateMany({ where: { organizationId, purpose: domain.purpose }, data: { isPrimary: false } }),
      this.prisma.domain.update({ where: { id }, data: { isPrimary: true } }),
    ])
    return this.ownedDomain(organizationId, id)
  }

  async remove(organizationId: string, id: string) {
    await this.ownedDomain(organizationId, id)
    await this.prisma.domain.delete({ where: { id } })
    return { deleted: true }
  }
}
