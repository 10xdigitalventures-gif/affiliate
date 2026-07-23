import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import { DEFAULT_PLANS } from '../src/entitlements/entitlements.constants'

export const ADMIN_PERMISSIONS = [
  'affiliates.read', 'affiliates.write',
  'stores.read', 'stores.write',
  'orders.read',
  'commissions.read', 'commissions.write',
  'payouts.read', 'payouts.write',
  'reports.read',
  'settings.write',
  'fraud.read', 'fraud.write',
  'billing.read', 'billing.write',
]

export interface EnsureAdminOptions {
  email: string
  password: string
  fullName?: string
  organizationSlug?: string
  organizationName?: string
}

export function loadLocalEnv() {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function validateAdminPassword(password: string) {
  const failures: string[] = []
  if (password.length < 12) failures.push('at least 12 characters')
  if (!/[a-z]/.test(password)) failures.push('a lowercase letter')
  if (!/[A-Z]/.test(password)) failures.push('an uppercase letter')
  if (!/[0-9]/.test(password)) failures.push('a number')
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('a symbol')
  if (failures.length > 0) {
    throw new Error(`ADMIN_PASSWORD must contain ${failures.join(', ')}.`)
  }
}

export async function ensureDefaultPlans(prisma: PrismaClient) {
  for (const plan of DEFAULT_PLANS) {
    const existing = await prisma.plan.findUnique({ where: { key: plan.key } })
    if (!existing) {
      await prisma.plan.create({
        data: {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        interval: plan.interval,
        features: plan.features,
        limits: plan.limits,
        sortOrder: plan.sortOrder,
        },
      })
      continue
    }
    // Preserve platform-owner pricing and packaging edits. Only introduce new
    // catalog keys that were absent in an older release.
    await prisma.plan.update({
      where: { id: existing.id },
      data: {
        features: { ...plan.features, ...((existing.features ?? {}) as Record<string, boolean>) },
        limits: { ...plan.limits, ...((existing.limits ?? {}) as Record<string, number>) },
      },
    })
  }
}

export async function ensureSuperAdmin(prisma: PrismaClient, options: EnsureAdminOptions) {
  const email = options.email.trim().toLowerCase()
  const password = options.password
  const fullName = (options.fullName || 'Platform Admin').trim()
  const requestedOrgSlug = (options.organizationSlug || 'demo').trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set a valid ADMIN_EMAIL environment variable.')
  }
  validateAdminPassword(password)

  const matchingUsers = await prisma.user.findMany({
    where: { email },
    include: { organization: { select: { slug: true } } },
  })
  const workspaceMatch = matchingUsers.find((candidate) => candidate.organization.slug === requestedOrgSlug)
  if (matchingUsers.length > 1 && !workspaceMatch) {
    throw new Error(
      `More than one workspace has email ${email}. Set ADMIN_ORG_SLUG to the intended workspace.`,
    )
  }

  const existing = workspaceMatch ?? matchingUsers[0]
  const organization = existing
    ? await prisma.organization.findUniqueOrThrow({ where: { id: existing.organizationId } })
    : await prisma.organization.upsert({
        where: { slug: requestedOrgSlug },
        update: { status: 'active' },
        create: {
          name: options.organizationName || 'MentoringHub',
          slug: requestedOrgSlug,
          status: 'active',
          plan: 'enterprise',
        },
      })

  await ensureDefaultPlans(prisma)
  const enterprisePlan = await prisma.plan.findUniqueOrThrow({ where: { key: 'enterprise' } })
  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: { planId: enterprisePlan.id, status: 'active' },
    create: { organizationId: organization.id, planId: enterprisePlan.id, status: 'active' },
  })

  for (const key of ADMIN_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } })
  }
  const permissions = await prisma.permission.findMany({ where: { key: { in: ADMIN_PERMISSIONS } } })
  let role = await prisma.role.findFirst({
    where: { organizationId: organization.id, name: 'Admin' },
  })
  if (!role) {
    role = await prisma.role.create({
      data: { organizationId: organization.id, name: 'Admin', isSystem: true },
    })
  } else if (!role.isSystem) {
    role = await prisma.role.update({ where: { id: role.id }, data: { isSystem: true } })
  }
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId: role!.id, permissionId: permission.id })),
    skipDuplicates: true,
  })

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName,
          passwordHash,
          status: 'active',
          isSuperAdmin: true,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      })
    : await prisma.user.create({
        data: {
          organizationId: organization.id,
          email,
          fullName,
          passwordHash,
          status: 'active',
          isSuperAdmin: true,
          emailVerifiedAt: new Date(),
        },
      })

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  })
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  return { user, organization }
}
