import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'

/**
 * Platform-owner (super-admin) operations that span every tenant:
 * building packages (plans), assigning them to organizations, and
 * managing tenant lifecycle. All methods assume the caller is a super admin
 * (enforced by SuperAdminGuard at the controller).
 */
@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Plans ────────────────────────────────────────────────────────────────
  listPlans() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    })
  }

  async createPlan(dto: CreatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { key: dto.key } })
    if (existing) throw new BadRequestException(`A plan with key "${dto.key}" already exists`)
    return this.prisma.plan.create({
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
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    await this.getPlan(id)
    return this.prisma.plan.update({
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
  }

  async getPlan(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    })
    if (!plan) throw new NotFoundException('Plan not found')
    return plan
  }

  /** Archive instead of hard-delete when a plan is still in use. */
  async deletePlan(id: string) {
    const plan = await this.getPlan(id)
    if (plan._count.subscriptions > 0) {
      const archived = await this.prisma.plan.update({ where: { id }, data: { isArchived: true, isPublic: false } })
      return { archived: true, plan: archived }
    }
    await this.prisma.plan.delete({ where: { id } })
    return { archived: false, deleted: true }
  }

  // ── Tenants (organizations) ───────────────────────────────────────────────
  async listTenants(search?: string) {
    const orgs = await this.prisma.organization.findMany({
      where: search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] } : undefined,
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
      plan: o.subscription?.plan ? { id: o.subscription.plan.id, key: o.subscription.plan.key, name: o.subscription.plan.name } : null,
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

  /** Assign (or move) a tenant to a plan, creating the subscription if needed. */
  async assignPlan(organizationId: string, dto: AssignPlanDto) {
    await this.getTenant(organizationId)
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
    // Keep the denormalized Organization.plan label in sync for legacy reads.
    await this.prisma.organization.update({ where: { id: organizationId }, data: { plan: plan.key } })
    return sub
  }

  async setTenantStatus(organizationId: string, dto: UpdateTenantStatusDto) {
    await this.getTenant(organizationId)
    return this.prisma.organization.update({ where: { id: organizationId }, data: { status: dto.status } })
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  async overview() {
    const [totalOrgs, activeOrgs, suspendedOrgs, totalUsers, totalAffiliates, plans, subs] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { status: 'active' } }),
      this.prisma.organization.count({ where: { status: 'suspended' } }),
      this.prisma.user.count(),
      this.prisma.affiliate.count(),
      this.prisma.plan.findMany({ include: { _count: { select: { subscriptions: true } } } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['active', 'past_due'] } }, include: { plan: true } }),
    ])

    // MRR: normalize annual plans to a monthly figure.
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
