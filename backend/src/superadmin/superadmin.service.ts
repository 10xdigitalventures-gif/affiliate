import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'
import { CreateTenantDto } from './dto/tenant.dto'
import { FEATURE_KEYS, LIMIT_KEYS } from '../entitlements/entitlements.constants'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { randomBytes } from 'crypto'

const DEFAULT_TENANT_PERMISSIONS = [
  'affiliates.read',
  'affiliates.write',
  'stores.read',
  'stores.write',
  'orders.read',
  'commissions.read',
  'commissions.write',
  'payouts.read',
  'payouts.write',
  'reports.read',
  'settings.write',
  'fraud.read',
  'fraud.write',
  'billing.read',
  'billing.write',
]

/**
 * Platform-owner (super-admin) operations that span every tenant:
 * building packages (plans), assigning them to organizations, and
 * managing tenant lifecycle. All methods assume the caller is a super admin
 * (enforced by SuperAdminGuard at the controller).
 */
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private normalizeFeatures(value: Record<string, unknown>): Record<string, boolean> {
    const unknown = Object.keys(value).filter((key) => !(FEATURE_KEYS as readonly string[]).includes(key))
    if (unknown.length) throw new BadRequestException(`Unknown plan feature(s): ${unknown.join(', ')}`)
    for (const [key, enabled] of Object.entries(value)) {
      if (typeof enabled !== 'boolean') throw new BadRequestException(`Plan feature ${key} must be true or false`)
    }
    return Object.fromEntries(FEATURE_KEYS.map((key) => [key, value[key] === true]))
  }

  private normalizeLimits(value: Record<string, unknown>): Record<string, number> {
    const unknown = Object.keys(value).filter((key) => !(LIMIT_KEYS as readonly string[]).includes(key))
    if (unknown.length) throw new BadRequestException(`Unknown plan limit(s): ${unknown.join(', ')}`)
    const result: Record<string, number> = {}
    for (const key of LIMIT_KEYS) {
      const raw = value[key] ?? 0
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < -1 || raw > 10_000_000) {
        throw new BadRequestException(`Plan limit ${key} must be -1 or a non-negative integer`)
      }
      result[key] = raw
    }
    return result
  }

  private normalizeOverrides(value?: { features?: Record<string, boolean>; limits?: Record<string, number> }) {
    if (!value) return undefined
    const features: Record<string, boolean> = {}
    const limits: Record<string, number> = {}
    for (const [key, enabled] of Object.entries(value.features ?? {})) {
      if (!(FEATURE_KEYS as readonly string[]).includes(key) || typeof enabled !== 'boolean') {
        throw new BadRequestException(`Invalid feature override: ${key}`)
      }
      features[key] = enabled
    }
    for (const [key, raw] of Object.entries(value.limits ?? {})) {
      if (!(LIMIT_KEYS as readonly string[]).includes(key) || !Number.isInteger(raw) || raw < -1 || raw > 10_000_000) {
        throw new BadRequestException(`Invalid limit override: ${key}`)
      }
      limits[key] = raw
    }
    return { features, limits }
  }

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
        features: this.normalizeFeatures(dto.features),
        limits: this.normalizeLimits(dto.limits),
        isPublic: dto.isPublic ?? true,
        sortOrder: dto.sortOrder ?? 0,
        trialDays: dto.trialDays ?? 0,
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
        features: dto.features ? this.normalizeFeatures(dto.features) : undefined,
        limits: dto.limits ? this.normalizeLimits(dto.limits) : undefined,
        isPublic: dto.isPublic,
        isArchived: dto.isArchived,
        sortOrder: dto.sortOrder,
        trialDays: dto.trialDays,
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
  async createTenant(dto: CreateTenantDto) {
    const slug = dto.slug.trim().toLowerCase()
    const ownerEmail = dto.ownerEmail.trim().toLowerCase()
    const name = dto.name.trim()
    const ownerName = dto.ownerName?.trim() || `${name} Owner`
    const status = dto.status ?? 'trial'

    const [existingOrg, existingUser] = await Promise.all([
      this.prisma.organization.findUnique({ where: { slug } }),
      this.prisma.user.findFirst({ where: { organization: { slug }, email: ownerEmail } }),
    ])
    if (existingOrg) throw new ConflictException('A workspace with this slug already exists')
    if (existingUser) throw new ConflictException('This owner email is already used in this workspace')

    const plan = dto.planId ? await this.prisma.plan.findUnique({ where: { id: dto.planId } }) : null
    if (dto.planId && !plan) throw new BadRequestException('Selected plan does not exist')
    if (plan?.isArchived) throw new BadRequestException('Archived plans cannot be assigned')

    // Email-code onboarding does not require a password. A cryptographically
    // random, unknowable fallback hash prevents password login until the owner
    // explicitly creates a password later.
    const passwordHash = await argon2.hash(dto.ownerPassword ?? randomBytes(32).toString('hex'))
    const passwordWasProvided = Boolean(dto.ownerPassword)

    // Permissions are global reference data. Provision and read them before
    // opening the interactive transaction so a remote database does not spend
    // most of its transaction timeout on 15 sequential upserts.
    await this.prisma.permission.createMany({
      data: DEFAULT_TENANT_PERMISSIONS.map((key) => ({ key })),
      skipDuplicates: true,
    })
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: DEFAULT_TENANT_PERMISSIONS } },
      select: { id: true },
    })
    if (permissions.length !== DEFAULT_TENANT_PERMISSIONS.length) {
      throw new Error('Tenant permission catalog could not be initialized')
    }
    const permissionIds = permissions.map((permission) => permission.id)

    try {
      return await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name,
          slug,
          status,
          plan: plan?.key ?? 'trial',
          defaultCurrency: dto.defaultCurrency ?? 'USD',
        },
      })

      const adminRole = await tx.role.create({
        data: {
          organizationId: organization.id,
          name: 'Admin',
          isSystem: true,
        },
      })
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: adminRole.id, permissionId })),
      })

      const owner = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: ownerEmail,
          passwordHash,
          fullName: ownerName,
          status: passwordWasProvided ? 'active' : 'invited',
          emailVerifiedAt: passwordWasProvided ? new Date() : null,
          isSuperAdmin: false,
        },
      })
      await tx.userRole.create({ data: { userId: owner.id, roleId: adminRole.id } })

      await tx.commissionRule.create({
        data: {
          organizationId: organization.id,
          scope: 'global',
          type: 'percentage',
          value: 10,
          priority: 0,
        },
      })

      let subscription: { status: string; currentPeriodEnd: Date | null } | null = null
      if (plan) {
        const now = new Date()
        const trialEndsAt = status === 'trial'
          ? new Date(now.getTime() + Math.max(plan.trialDays, 1) * 86_400_000)
          : null
        const currentPeriodEnd = trialEndsAt ?? this.nextPlanPeriod(plan.interval, now)
        subscription = await tx.subscription.create({
          data: {
            organizationId: organization.id,
            planId: plan.id,
            status: status === 'trial' ? 'trialing' : 'active',
            currentPeriodEnd,
            trialEndsAt,
          },
          select: { status: true, currentPeriodEnd: true },
        })
      }

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        createdAt: organization.createdAt,
        plan: plan ? { id: plan.id, key: plan.key, name: plan.name } : null,
        subscriptionStatus: subscription?.status ?? null,
        owner: { id: owner.id, email: owner.email, fullName: owner.fullName },
        counts: { users: 1, stores: 0, affiliates: 0 },
      }
      }, { maxWait: 10_000, timeout: 30_000 })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
        throw new ConflictException('That workspace ID or owner account already exists')
      }
      throw error
    }
  }

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
    const [entitlements, usage] = await Promise.all([
      this.entitlements.getContext(id),
      this.entitlements.usage(id),
    ])
    return { ...org, entitlements, usage }
  }

  /** Assign (or move) a tenant to a plan, creating the subscription if needed. */
  async assignPlan(organizationId: string, dto: AssignPlanDto) {
    await this.getTenant(organizationId)
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } })
    if (!plan) throw new NotFoundException('Plan not found')
    if (plan.isArchived) throw new BadRequestException('Archived plans cannot be assigned')

    const status = dto.status ?? 'active'
    const now = new Date()
    const trialEndsAt = status === 'trialing'
      ? new Date(now.getTime() + Math.max(plan.trialDays, 1) * 86_400_000)
      : null
    const currentPeriodEnd = status === 'active'
      ? this.nextPlanPeriod(plan.interval, now)
      : trialEndsAt
    const overrides = this.normalizeOverrides(dto.overrides)
    const sub = await this.prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        status,
        seats: dto.seats ?? 0,
        overrides,
        trialEndsAt,
        currentPeriodEnd,
        pastDueSince: status === 'past_due' ? now : null,
      },
      update: {
        planId: plan.id,
        status,
        seats: dto.seats,
        overrides,
        trialEndsAt,
        currentPeriodEnd,
        pastDueSince: status === 'past_due' ? now : null,
        billingLockAt: null,
        billingLockToken: null,
      },
      include: { plan: true },
    })
    // Keep the denormalized Organization.plan label in sync for legacy reads.
    await this.prisma.organization.update({ where: { id: organizationId }, data: { plan: plan.key } })
    return sub
  }

  private nextPlanPeriod(interval: 'month' | 'year', from: Date) {
    const date = new Date(from)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    if (interval === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1)
    else date.setUTCMonth(date.getUTCMonth() + 1)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, last))
    return date
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
