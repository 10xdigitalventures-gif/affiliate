import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateCommissionRuleDto } from './dto/commission-rule.dto'

@Injectable()
export class CommissionRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** List all commission rules for an org, most specific scope first. */
  async list(organizationId: string) {
    const rank: Record<string, number> = { affiliate: 50, product: 40, category: 30, store: 20, campaign: 15, global: 10 }
    const rules = await this.prisma.commissionRule.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } })
    return rules.sort((a, b) => (b.priority - a.priority) || ((rank[b.scope] ?? 0) - (rank[a.scope] ?? 0)))
  }

  async create(organizationId: string, dto: CreateCommissionRuleDto, actorUserId?: string) {
    if (dto.scope !== 'global' && !dto.scopeRefId) {
      throw new BadRequestException(`scopeRefId is required for scope "${dto.scope}"`)
    }
    // Validate the referenced entity belongs to this org (best-effort, scope-specific).
    await this.assertScopeRef(organizationId, dto.scope, dto.scopeRefId)

    const rule = await this.prisma.commissionRule.create({
      data: {
        organizationId,
        scope: dto.scope as any,
        scopeRefId: dto.scope === 'global' ? null : dto.scopeRefId ?? null,
        type: dto.type as any,
        value: new Prisma.Decimal(dto.value),
        priority: dto.priority ?? 0,
        stackable: dto.stackable ?? false,
      },
    })
    await this.audit
      .log({ organizationId, userId: actorUserId, action: 'commission_rule.create', resourceType: 'commission_rule', resourceId: rule.id, newValue: { scope: rule.scope, scopeRefId: rule.scopeRefId, type: rule.type, value: String(rule.value) } })
      .catch(() => {})
    return rule
  }

  async remove(organizationId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.commissionRule.findFirst({ where: { id, organizationId } })
    if (!existing) throw new NotFoundException('Commission rule not found')
    await this.prisma.commissionRule.delete({ where: { id } })
    await this.audit
      .log({ organizationId, userId: actorUserId, action: 'commission_rule.delete', resourceType: 'commission_rule', resourceId: id, oldValue: { scope: existing.scope, scopeRefId: existing.scopeRefId } })
      .catch(() => {})
    return { deleted: true }
  }

  /** Ensure the scopeRefId points at something in this org, when we can check it. */
  private async assertScopeRef(organizationId: string, scope: string, scopeRefId?: string) {
    if (!scopeRefId) return
    if (scope === 'product') {
      const p = await this.prisma.product.findFirst({ where: { id: scopeRefId, store: { organizationId } }, select: { id: true } })
      if (!p) throw new BadRequestException('Unknown product for this organization')
    } else if (scope === 'category') {
      const c = await this.prisma.category.findFirst({ where: { id: scopeRefId, organizationId }, select: { id: true } })
      if (!c) throw new BadRequestException('Unknown category for this organization')
    } else if (scope === 'store') {
      const s = await this.prisma.store.findFirst({ where: { id: scopeRefId, organizationId }, select: { id: true } })
      if (!s) throw new BadRequestException('Unknown store for this organization')
    } else if (scope === 'affiliate') {
      const a = await this.prisma.affiliate.findFirst({ where: { id: scopeRefId, organizationId }, select: { id: true } })
      if (!a) throw new BadRequestException('Unknown affiliate for this organization')
    }
  }
}
