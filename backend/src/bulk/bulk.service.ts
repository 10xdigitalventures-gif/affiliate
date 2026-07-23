import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildCsv, parseCsv } from './csv.util'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { AFFILIATE_CODE_PATTERN, REFERRAL_SLUG_PATTERN } from '../affiliates/dto/create-affiliate.dto'

export type ExportEntity = 'affiliates' | 'commissions' | 'orders' | 'payouts'

export interface ImportResult {
  total: number
  created: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

const AFFILIATE_TEMPLATE_HEADER = ['affiliateCode', 'referralSlug', 'status', 'parentAffiliateCode']

@Injectable()
export class BulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  affiliateTemplate(): string {
    return buildCsv(AFFILIATE_TEMPLATE_HEADER, [
      ['SUMMER10', 'summer10', 'approved', ''],
      ['JANE', 'jane', 'pending', 'SUMMER10'],
    ])
  }

  async exportCsv(organizationId: string, entity: ExportEntity): Promise<string> {
    switch (entity) {
      case 'affiliates': {
        const rows = await this.prisma.affiliate.findMany({
          where: { organizationId },
          include: { parent: { select: { affiliateCode: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        })
        return buildCsv(
          ['id', 'affiliateCode', 'referralSlug', 'status', 'parentAffiliateCode', 'lifetimeEarnings', 'availableBalance', 'createdAt'],
          rows.map((r) => [
            r.id, r.affiliateCode, r.referralSlug, r.status, r.parent?.affiliateCode ?? '',
            String(r.lifetimeEarnings ?? 0), String(r.availableBalance ?? 0), r.createdAt.toISOString(),
          ]),
        )
      }
      case 'commissions': {
        const rows = await this.prisma.commission.findMany({
          where: { affiliate: { organizationId } },
          include: { affiliate: { select: { affiliateCode: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        })
        return buildCsv(
          ['id', 'affiliateCode', 'amount', 'currency', 'status', 'tier', 'orderId', 'createdAt'],
          rows.map((r) => [
            r.id, r.affiliate.affiliateCode, String(r.amount), r.currency, r.status,
            String((r as any).tier ?? 0), r.orderId ?? '', r.createdAt.toISOString(),
          ]),
        )
      }
      case 'orders': {
        const rows = await this.prisma.order.findMany({
          where: { store: { organizationId } },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        })
        return buildCsv(
          ['externalOrderId', 'status', 'currency', 'subtotal', 'total', 'refundAmount', 'placedAt'],
          rows.map((r) => [
            r.externalOrderId, r.status, r.currency, String(r.subtotal), String(r.total),
            String(r.refundAmount), r.placedAt?.toISOString() ?? '',
          ]),
        )
      }
      case 'payouts': {
        const rows = await this.prisma.payout.findMany({
          where: { affiliate: { organizationId } },
          include: { affiliate: { select: { affiliateCode: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        })
        return buildCsv(
          ['id', 'affiliateCode', 'amount', 'currency', 'method', 'status', 'transactionReference', 'createdAt'],
          rows.map((r) => [
            r.id, r.affiliate.affiliateCode, String(r.amount), r.currency, r.method, r.status,
            r.transactionReference ?? '', r.createdAt.toISOString(),
          ]),
        )
      }
    }
  }

  /**
   * Bulk-create affiliates from CSV. Columns: affiliateCode (required),
   * referralSlug, status, parentAffiliateCode. Existing codes are skipped.
   * Parent linkage is resolved after creation so parents defined later still link.
   */
  async importAffiliates(organizationId: string, csv: string): Promise<ImportResult> {
    const records = parseCsv(csv)
    const result: ImportResult = { total: records.length, created: 0, skipped: 0, errors: [] }
    const validStatuses = new Set(['pending', 'approved', 'suspended', 'rejected'])

    // Preload existing codes to detect duplicates cheaply.
    const existing = await this.prisma.affiliate.findMany({
      where: { organizationId },
      select: { affiliateCode: true, referralSlug: true },
    })
    const seenCodes = new Set(existing.map((e) => e.affiliateCode.toUpperCase()))
    const seenSlugs = new Set(existing.map((e) => e.referralSlug.toLowerCase()))

    // Reserve plan capacity once before mutating data. Invalid/duplicate rows
    // are excluded, so bulk imports cannot bypass the ordinary affiliate cap.
    const capacityCodes = new Set<string>()
    const capacitySlugs = new Set<string>()
    for (const record of records) {
      const code = (record.affiliateCode || '').trim().toUpperCase()
      const status = (record.status || 'pending').trim().toLowerCase()
      const slug = (record.referralSlug || code).trim().toLowerCase()
      if (
        AFFILIATE_CODE_PATTERN.test(code) &&
        REFERRAL_SLUG_PATTERN.test(slug) &&
        validStatuses.has(status) &&
        !seenCodes.has(code) &&
        !seenSlugs.has(slug) &&
        !capacityCodes.has(code) &&
        !capacitySlugs.has(slug)
      ) {
        capacityCodes.add(code)
        capacitySlugs.add(slug)
      }
    }
    if (capacityCodes.size > 0) {
      await this.entitlements.assertWithinLimit(organizationId, 'affiliates', capacityCodes.size)
    }

    const parentLinks: Array<{ code: string; parentCode: string; row: number }> = []

    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 2 // header is row 1
      const rec = records[i]
      const code = (rec.affiliateCode || '').trim().toUpperCase()
      try {
        if (!code) { result.errors.push({ row: rowNum, message: 'Missing affiliateCode' }); continue }
        if (!AFFILIATE_CODE_PATTERN.test(code)) {
          result.errors.push({ row: rowNum, message: 'Invalid affiliateCode format (2-64 letters, numbers, underscores or hyphens)' }); continue
        }
        if (seenCodes.has(code)) { result.skipped++; continue }

        const status = (rec.status || 'pending').trim().toLowerCase()
        if (!validStatuses.has(status)) {
          result.errors.push({ row: rowNum, message: `Invalid status "${status}"` }); continue
        }
        const slug = (rec.referralSlug || code).trim().toLowerCase()
        if (!REFERRAL_SLUG_PATTERN.test(slug)) {
          result.errors.push({ row: rowNum, message: 'Invalid referralSlug format (1-64 lowercase letters, numbers or hyphens)' }); continue
        }
        if (seenSlugs.has(slug)) {
          result.errors.push({ row: rowNum, message: `Referral slug "${slug}" is already in use` }); continue
        }

        await this.prisma.affiliate.create({
          data: { organizationId, affiliateCode: code, referralSlug: slug, status: status as any },
        })
        seenCodes.add(code)
        seenSlugs.add(slug)
        result.created++

        const parentCode = (rec.parentAffiliateCode || '').trim().toUpperCase()
        if (parentCode) parentLinks.push({ code, parentCode, row: rowNum })
      } catch (e: any) {
        result.errors.push({ row: rowNum, message: e?.message ? String(e.message).slice(0, 200) : 'Create failed' })
      }
    }

    // Resolve parent linkage in memory and reject every direct or indirect
    // cycle, including cycles that pass through pre-existing affiliates.
    const affiliates = await this.prisma.affiliate.findMany({
      where: { organizationId },
      select: { id: true, affiliateCode: true, parentAffiliateId: true },
    })
    const byCode = new Map(affiliates.map((affiliate) => [affiliate.affiliateCode.toUpperCase(), affiliate]))
    const parentById = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate.parentAffiliateId]))
    for (const link of parentLinks) {
      const child = byCode.get(link.code)
      const parent = byCode.get(link.parentCode)
      if (!child || !parent) {
        result.errors.push({ row: link.row, message: `Parent affiliate "${link.parentCode}" was not found` })
        continue
      }
      let cursor: string | null = parent.id
      const visited = new Set<string>()
      let cycle = false
      while (cursor) {
        if (cursor === child.id || visited.has(cursor)) { cycle = true; break }
        visited.add(cursor)
        cursor = parentById.get(cursor) ?? null
      }
      if (cycle) {
        result.errors.push({ row: link.row, message: 'Parent relationship would create an affiliate cycle' })
        continue
      }
      await this.prisma.affiliate.update({ where: { id: child.id }, data: { parentAffiliateId: parent.id } })
      parentById.set(child.id, parent.id)
    }

    return result
  }
}
