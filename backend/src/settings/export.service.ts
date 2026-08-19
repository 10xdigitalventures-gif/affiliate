import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * GDPR Article 20 - Right to data portability.
 * Collects all tenant-owned data and returns it as a single JSON object.
 * For large datasets, callers should stream the response.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportTenantData(organizationId: string) {
    const [affiliates, commissions, payouts, apiKeys, auditLogs, stores] = await Promise.all([
      this.prisma.affiliate.findMany({ where: { organizationId } }),
      this.prisma.commission.findMany({
        where: { affiliate: { organizationId } },
        include: { affiliate: { select: { email: true } } },
      }),
      this.prisma.payout.findMany({ where: { organizationId } }),
      this.prisma.apiKey.findMany({
        where: { organizationId },
        // Never include the raw key hash in the export
        select: { id: true, name: true, prefix: true, createdAt: true, expiresAt: true, lastUsedAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 10_000, // cap to avoid giant exports
      }),
      this.prisma.store.findMany({ where: { organizationId } }),
    ])

    return {
      exportedAt: new Date().toISOString(),
      organizationId,
      affiliates,
      commissions,
      payouts,
      apiKeys,
      auditLogs,
      stores,
    }
  }
}
