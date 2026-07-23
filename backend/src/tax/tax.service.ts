import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { TaxFormDto } from './dto/tax-form.dto'

export interface TaxSettings {
  required: boolean
  threshold: number
}

const TAX_DEFAULTS: TaxSettings = { required: false, threshold: 600 }

type StoredTaxInfo = {
  formType: 'w9' | 'w8ben'
  legalName: string
  businessName: string | null
  taxClassification: string | null
  tinType: 'ssn' | 'ein' | null
  tinCiphertext: string
  tinLast4: string
  country: string
  address1: string
  address2: string | null
  city: string
  state: string | null
  postalCode: string | null
  signature: string
  certifiedAt: string
  status: 'submitted' | 'verified' | 'rejected'
  reviewNote?: string | null
}

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async requireAffiliate(affiliateId?: string | null) {
    if (!affiliateId) throw new ForbiddenException('This account is not linked to an affiliate')
    const a = await this.prisma.affiliate.findUnique({ where: { id: affiliateId } })
    if (!a) throw new ForbiddenException('Affiliate not found')
    return a
  }

  private async requireAffiliateInOrg(organizationId: string, id: string) {
    const a = await this.prisma.affiliate.findFirst({ where: { id, organizationId } })
    if (!a) throw new NotFoundException('Affiliate not found')
    return a
  }

  /** Public-safe view — never exposes the encrypted TIN. */
  private mask(taxInfo: unknown) {
    const info = taxInfo as StoredTaxInfo | null
    if (!info || !info.status) return { status: 'not_submitted' as const, formType: null }
    const { tinCiphertext, ...rest } = info
    return { ...rest, hasTin: !!tinCiphertext }
  }

  async settings(organizationId: string): Promise<TaxSettings> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    const cfg = ((org?.settings as Record<string, unknown>)?.tax ?? {}) as Partial<TaxSettings>
    return { ...TAX_DEFAULTS, ...cfg }
  }

  async updateSettings(organizationId: string, dto: { required: boolean; threshold?: number }): Promise<TaxSettings> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    const current = (org?.settings as Record<string, unknown>) ?? {}
    const next: TaxSettings = {
      required: dto.required,
      threshold: dto.threshold ?? TAX_DEFAULTS.threshold,
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...current, tax: next } as any },
    })
    return next
  }

  async portalStatus(affiliateId?: string | null) {
    const a = await this.requireAffiliate(affiliateId)
    const cfg = await this.settings(a.organizationId)
    return { ...this.mask(a.taxInfo), required: cfg.required }
  }

  async portalSubmit(affiliateId: string | null | undefined, dto: TaxFormDto) {
    const a = await this.requireAffiliate(affiliateId)
    if (!dto.certify) throw new BadRequestException('You must certify the form under penalties of perjury')
    const digits = dto.tin.replace(/[^0-9]/g, '')
    if (digits.length < 9) throw new BadRequestException('Enter a valid 9-digit TIN (SSN or EIN)')
    const ciphertext = this.crypto.encrypt(digits).toString('base64')
    const info: StoredTaxInfo = {
      formType: dto.formType,
      legalName: dto.legalName,
      businessName: dto.businessName ?? null,
      taxClassification: dto.taxClassification ?? null,
      tinType: dto.tinType ?? null,
      tinCiphertext: ciphertext,
      tinLast4: digits.slice(-4),
      country: dto.country,
      address1: dto.address1,
      address2: dto.address2 ?? null,
      city: dto.city,
      state: dto.state ?? null,
      postalCode: dto.postalCode ?? null,
      signature: dto.signature,
      certifiedAt: new Date().toISOString(),
      status: 'submitted',
      reviewNote: null,
    }
    await this.prisma.affiliate.update({ where: { id: a.id }, data: { taxInfo: info as unknown as object } })
    return this.mask(info)
  }

  async adminGet(organizationId: string, id: string) {
    const a = await this.requireAffiliateInOrg(organizationId, id)
    return { affiliateId: a.id, affiliateCode: a.affiliateCode, ...this.mask(a.taxInfo) }
  }

  /** Reveal the full decrypted TIN. Restricted to admins with payouts.write. */
  async revealTin(organizationId: string, id: string) {
    const a = await this.requireAffiliateInOrg(organizationId, id)
    const info = a.taxInfo as StoredTaxInfo | null
    if (!info?.tinCiphertext) throw new NotFoundException('No tax form on file')
    const tin = this.crypto.decrypt(Buffer.from(info.tinCiphertext, 'base64'))
    return { tin, tinType: info.tinType, legalName: info.legalName }
  }

  async setReview(organizationId: string, id: string, status: 'verified' | 'rejected', note?: string) {
    const a = await this.requireAffiliateInOrg(organizationId, id)
    const info = a.taxInfo as StoredTaxInfo | null
    if (!info?.status) throw new BadRequestException('This affiliate has not submitted a tax form')
    const next = { ...info, status, reviewNote: note ?? null }
    await this.prisma.affiliate.update({ where: { id: a.id }, data: { taxInfo: next as unknown as object } })
    return this.mask(next)
  }

  /** IRS-style year-end report: affiliates paid >= threshold who need a 1099-NEC. */
  async report(organizationId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year + 1, 0, 1))
    const cfg = await this.settings(organizationId)
    const grouped = await this.prisma.payout.groupBy({
      by: ['affiliateId'],
      where: { organizationId, status: 'paid', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    })
    const ids = grouped.map((g) => g.affiliateId)
    const affiliates = ids.length
      ? await this.prisma.affiliate.findMany({
          where: { id: { in: ids } },
          select: { id: true, affiliateCode: true, taxInfo: true, user: { select: { email: true, fullName: true } } },
        })
      : []
    const byId = new Map(affiliates.map((a) => [a.id, a]))
    const rows = grouped
      .map((g) => {
        const a = byId.get(g.affiliateId)
        const info = (a?.taxInfo ?? null) as StoredTaxInfo | null
        const totalPaid = Number(g._sum.amount ?? 0)
        const formStatus = info?.status ?? 'not_submitted'
        const meetsThreshold = totalPaid >= cfg.threshold
        return {
          affiliateId: g.affiliateId,
          affiliateCode: a?.affiliateCode ?? '-',
          name: info?.legalName ?? a?.user?.fullName ?? null,
          email: a?.user?.email ?? null,
          totalPaid,
          formType: info?.formType ?? null,
          formStatus,
          tinLast4: info?.tinLast4 ?? null,
          country: info?.country ?? null,
          meetsThreshold,
          needs1099: meetsThreshold && (info?.formType ?? 'w9') === 'w9',
          missingForm: meetsThreshold && formStatus === 'not_submitted',
        }
      })
      .sort((a, b) => b.totalPaid - a.totalPaid)
    return {
      year,
      threshold: cfg.threshold,
      currency: 'USD',
      totalReportable: rows.filter((r) => r.needs1099).length,
      missingForms: rows.filter((r) => r.missingForm).length,
      rows,
    }
  }

  /** Payout gate: throws when the org requires a tax form the affiliate has not completed. */
  async assertPayoutAllowed(organizationId: string, affiliateId: string) {
    const cfg = await this.settings(organizationId)
    if (!cfg.required) return
    const a = await this.prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { taxInfo: true } })
    const status = (a?.taxInfo as StoredTaxInfo | null)?.status
    if (status !== 'submitted' && status !== 'verified') {
      throw new BadRequestException('A completed tax form (W-9 or W-8BEN) is required before you can request a payout. Please submit your tax details first.')
    }
  }
}
