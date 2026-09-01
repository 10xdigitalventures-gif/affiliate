import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import { DEFAULT_PLANS } from '../src/entitlements/entitlements.constants'

const prisma = new PrismaClient()

const PERMISSIONS = [
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

async function main() {
  // Organization (tenant)
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Merchant', slug: 'demo', status: 'active', plan: 'enterprise' },
  })

  // Platform packages (plans)
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { key: p.key },
      update: {
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        interval: p.interval,
        features: p.features,
        limits: p.limits,
        sortOrder: p.sortOrder,
      },
      create: {
        key: p.key,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        interval: p.interval,
        features: p.features,
        limits: p.limits,
        sortOrder: p.sortOrder,
      },
    })
  }
  const enterprisePlan = await prisma.plan.findUnique({ where: { key: 'enterprise' } })
  if (enterprisePlan) {
    await prisma.subscription.upsert({
      where: { organizationId: org.id },
      update: { planId: enterprisePlan.id, status: 'active' },
      create: { organizationId: org.id, planId: enterprisePlan.id, status: 'active' },
    })
  }

  // Permissions
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } })
  }
  const permissions = await prisma.permission.findMany()

  // Admin role (idempotent: find or create)
  let adminRole = await prisma.role.findFirst({
    where: { organizationId: org.id, name: 'Admin' },
  })
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: { organizationId: org.id, name: 'Admin', isSystem: true },
    })
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: adminRole!.id, permissionId: p.id })),
      skipDuplicates: true,
    })
  }

  // Admin user: admin@demo.test / password123
  const adminPasswordHash = await argon2.hash('password123')
  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'admin@demo.test' } },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@demo.test',
      fullName: 'Demo Admin',
      passwordHash: adminPasswordHash,
      status: 'active',
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    },
  })
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  })

  // Default commission rule (global 10%)
  const existingRule = await prisma.commissionRule.findFirst({
    where: { organizationId: org.id, scope: 'global' },
  })
  if (!existingRule) {
    await prisma.commissionRule.create({
      data: { organizationId: org.id, scope: 'global', type: 'percentage', value: 10, priority: 0 },
    })
  }

  // Demo store
  let store = await prisma.store.findFirst({
    where: { organizationId: org.id, domain: 'demo.myshopify.com' },
  })
  if (!store) {
    store = await prisma.store.create({
      data: { organizationId: org.id, platform: 'shopify', name: 'Demo Shopify Store', domain: 'demo.myshopify.com', status: 'connected' },
    })
  }

  // Approved affiliate + referral link + coupon
  let affiliate = await prisma.affiliate.findFirst({
    where: { organizationId: org.id, affiliateCode: 'ABAAN001' },
  })
  if (!affiliate) {
    affiliate = await prisma.affiliate.create({
      data: { organizationId: org.id, affiliateCode: 'ABAAN001', referralSlug: 'abaan001', status: 'approved' },
    })
  }

  const existingLink = await prisma.affiliateLink.findUnique({ where: { shortCode: 'AB123XY' } })
  if (!existingLink) {
    await prisma.affiliateLink.create({
      data: { affiliateId: affiliate.id, storeId: store.id, destinationUrl: 'https://demo.myshopify.com', shortCode: 'AB123XY' },
    })
  }

  // Affiliate portal login: affiliate@demo.test / password123
  const affiliatePasswordHash = await argon2.hash('password123')
  const affiliateUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'affiliate@demo.test' } },
    update: {},
    create: {
      organizationId: org.id,
      email: 'affiliate@demo.test',
      fullName: 'Abaan (Affiliate)',
      passwordHash: affiliatePasswordHash,
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  })
  await prisma.affiliate.update({ where: { id: affiliate.id }, data: { userId: affiliateUser.id } })

  // Demo customer + 12 days of orders/clicks/conversions/commissions
  let customer = await prisma.customer.findFirst({
    where: { organizationId: org.id, email: 'buyer@example.com' },
  })
  if (!customer) {
    customer = await prisma.customer.create({
      data: { organizationId: org.id, email: 'buyer@example.com', firstAffiliateId: affiliate.id },
    })
  }

  // Only seed orders if none exist yet
  const existingOrders = await prisma.order.count({ where: { storeId: store.id } })
  if (existingOrders === 0) {
    const statuses = ['pending', 'approved', 'payable', 'approved', 'pending'] as const
    let lifetime = 0
    for (let i = 0; i < 12; i++) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      const subtotal = 80 + Math.round(Math.random() * 120)
      const order = await prisma.order.create({
        data: {
          storeId: store.id,
          externalOrderId: `SEED-${1000 + i}`,
          customerId: customer.id,
          affiliateId: affiliate.id,
          currency: 'USD',
          subtotal,
          tax: 0,
          shipping: 0,
          total: subtotal,
          status: 'paid',
          placedAt: day,
          createdAt: day,
        },
      })
      for (let c = 0; c < 3; c++) {
        await prisma.click.create({ data: { affiliateId: affiliate.id, storeId: store.id, occurredAt: day } })
      }
      await prisma.conversion.create({
        data: { orderId: order.id, affiliateId: affiliate.id, attributionMethod: 'cookie', createdAt: day },
      })
      const amount = Math.round(subtotal * 10) / 100 // 10%
      const status = statuses[i % statuses.length]
      await prisma.commission.create({
        data: {
          orderId: order.id,
          affiliateId: affiliate.id,
          amount,
          currency: 'USD',
          status,
          idempotencyKey: `seed-commission-${order.id}`,
          createdAt: day,
          updatedAt: day,
        },
      })
      if (status !== 'pending') lifetime += amount
    }
    await prisma.affiliate.update({
      where: { id: affiliate.id },
      data: { lifetimeEarnings: lifetime, availableBalance: lifetime },
    })

    // Payout method
    const existingMethod = await prisma.payoutMethodRecord.findFirst({ where: { affiliateId: affiliate.id } })
    if (!existingMethod) {
      await prisma.payoutMethodRecord.create({
        data: { affiliateId: affiliate.id, method: 'bank', isDefault: true },
      })
    }

    // Demo approved payout
    const payableCommissions = await prisma.commission.findMany({
      where: { affiliateId: affiliate.id, status: 'payable', payoutItemId: null },
      take: 2,
    })
    if (payableCommissions.length > 0) {
      const payoutTotal = payableCommissions.reduce((s, c) => s + Number(c.amount), 0)
      const demoPayout = await prisma.payout.create({
        data: {
          organizationId: org.id,
          affiliateId: affiliate.id,
          amount: payoutTotal,
          currency: 'USD',
          method: 'bank',
          status: 'approved',
          items: { create: payableCommissions.map((c) => ({ amount: c.amount })) },
        },
        include: { items: true },
      })
      await Promise.all(
        payableCommissions.map((c, i) =>
          prisma.commission.update({ where: { id: c.id }, data: { payoutItemId: demoPayout.items[i].id } }),
        ),
      )
    }
  }

  // Coupon (idempotent)
  const existingCoupon = await prisma.coupon.findFirst({ where: { storeId: store.id, code: 'ABAAN10' } })
  if (!existingCoupon) {
    await prisma.coupon.create({
      data: { storeId: store.id, affiliateId: affiliate.id, code: 'ABAAN10', discountType: 'percentage', status: 'active' },
    })
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete.')
  console.log('  Login:      admin@demo.test / password123')
  console.log('  Affiliate:  affiliate@demo.test / password123')
  console.log('  Store ID:   ' + store.id)
  console.log('  Affiliate:  ABAAN001 (approved)  coupon: ABAAN10  link: /v1/track/r/AB123XY')
}

main().finally(() => prisma.$disconnect())
