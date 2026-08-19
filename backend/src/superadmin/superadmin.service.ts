import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'

// A stable sentinel org-id used when a superadmin action has no single target
// tenant (e.g. creating a global plan). Kept out of normal org queries by the
// tenant-scope middleware which filters by the real organizationId.
const PLATFORM_ORG_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Platform-owner (super-admin) operations that span every tenant.
 * All methods assume the caller is a super admin (enforced by SuperAdminGuard).
 * Every mutating operation is written to the audit log so there is a complete
 * trail of who changed what and when.
 */
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Plans
  listPlans() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    })
  }

  async createPlan(dto: CreatePlanDto, actorId: string) {
    const existing = await this.prisma.plan.findUnique({ where: { key: dto.key } })
    if (existing) throw new BadRequestException(`A plan with key "${dto.key}" already exists`)
    const plan = await this.prisma.plan.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        priceCents: dto.priceCents,
        currency: dto.currency ?? 'USD',
        interval: dto.interval ?? 'month',
        features: dto.features,
        limits: dto.limits,
        isPublic: dto.isPublic ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    })
    await this.audit.log({
      organizationId: PLATFORM_ORG_ID,
      userId: actorId,
      action: 'superadmin.plan.create',
      resourceType: 'plan',
      resourceId: plan.id,
      newValue: { key: plan.key, name: plan.name, priceCents: plan.priceCents },
    })
    return plan
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorId: string) {
    const before = await this.getPlan(id)
    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        currency: dto.currency,
        interval: dto.interval,
        features: dto.features,
        limits: dto.limits,
        isPublic: dto.isPublic,
        isArchived: dto.isArchived,
        sortOrder: dto.sortOrder,
      },
    })
    await this.audit.log({
      organizationId: PLATFORM_ORG_ID,
      userId: actorId,
      action: 'superadmin.plan.update',
      resourceType: 'plan',
      resourceId: id,
      oldValue: { name: before.name, priceCents: before.priceCents, isPublic: before.isPublic },
      newValue: { name: updated.name, priceCents: updated.priceCents, isPublic: updated.isPublic },
    })
    return updated
  }

  async getPlan(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    })
    if (!plan) throw new NotFoundException('Plan not found')
    return plan
  }

  async deletePlan(id: string, actorId: string) {
    const plan = await this.getPlan(id)
    if (plan._count.subscriptions > 0) {
      const archived = await this.prisma.plan.update({ where: { id }, data: { isArchived: true, isPublic: false } })
      await this.audit.log({
        organizationId: PLATFORM_ORG_ID,
        userId: actorId,
        action: 'superadmin.plan.archive',
        resourceType: 'plan',
        resourceId: id,
        newValue: { key: plan.key, reason: 'has active subscriptions' },
      })
      return { archived: true, plan: archived }
    }
    await this.prisma.plan.delete({ where: { id } })
    await this.audit.log({
      organizationId: PLATFORM_ORG_ID,
      userId: actorId,
      action: 'superadmin.plan.delete',
      resourceType: 'plan',
      resourceId: id,
      oldValue: { key: plan.key, name: plan.name },
    })
    return { archived: false, deleted: true }
  }

  // Tenants
  async listTenants(search?: string) {
    const orgs = await this.prisma.organization.findMany({
      where: search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { users: true, affiliates: true, stores: true } },
      },
    })
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      createdAt: o.createdAt,
      plan: o.subscription?.plan
        ? { id: o.subscription.plan.id, key: o.subscription.plan.key, name: o.subscription.plan.name }
        : null,
      subscriptionStatus: o.subscription?.status ?? null,
      counts: o._count,
    }))
  }

  async getTenant(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { users: true, affiliates: true, stores: true, apiKeys: true } },
      },
    })
    if (!org) throw new NotFoundException('Tenant not found')
    return org
  }

  async assignPlan(organizationId: string, dto: AssignPlanDto, actorId: string) {
    const org = await this.getTenant(organizationId)
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } })
    if (!plan) throw new NotFoundException('Plan not found')
    const sub = await this.prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        status: dto.status ?? 'active',
        seats: dto.seats ?? 0,
        overrides: dto.overrides ?? undefined,
      },
      update: {
        planId: plan.id,
        status: dto.status ?? 'active',
        seats: dto.seats,
        overrides: dto.overrides ?? undefined,
      },
      include: { plan: true },
    })
    await this.prisma.organization.update({ where: { id: organizationId }, data: { plan: plan.key } })
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: 'superadmin.tenant.assignPlan',
      resourceType: 'organization',
      resourceId: organizationId,
      newValue: { orgSlug: org.slug, planKey: plan.key, status: sub.status },
    })
    return sub
  }

  async setTenantStatus(organizationId: string, dto: UpdateTenantStatusDto, actorId: string) {
    const org = await this.getTenant(organizationId)
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status: dto.status },
    })
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: 'superadmin.tenant.setStatus',
      resourceType: 'organization',
      resourceId: organizationId,
      oldValue: { status: org.status },
      newValue: { status: dto.status },
    })
    return updated
  }

  // Overview
  async overview() {
    const [totalOrgs, activeOrgs, suspendedOrgs, totalUsers, totalAffiliates, plans, subs] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { status: 'active' } }),
      this.prisma.organization.count({ where: { status: 'suspended' } }),
      this.prisma.user.count(),
      this.prisma.affiliate.count(),
      this.prisma.plan.findMany({ include: { _count: { select: { subscriptions: true } } } }),
      this.prisma.subscription.findMany({
        where: { status: { in: ['active', 'past_due'] } },
        include: { plan: true },
      }),
    ])
    const mrrCents = subs.reduce((sum, s) => {
      const monthly = s.plan.interval === 'year' ? Math.round(s.plan.priceCents / 12) : s.plan.priceCents
      return sum + monthly
    }, 0)
    return {
      totalOrgs,
      activeOrgs,
      suspendedOrgs,
      totalUsers,
      totalAffiliates,
      activeSubscriptions: subs.length,
      mrrCents,
      planDistribution: plans.map((p) => ({ key: p.key, name: p.name, subscribers: p._count.subscriptions })),
    }
  }
}
