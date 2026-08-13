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

  // Platform packages (plans). Owners edit these in the super-admin console.
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

  // Admin role with all permissions
  const adminRole = await prisma.role.create({
    data: { organizationId: org.id, name: 'Admin', isSystem: true },
  })
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
  })

  // Admin user: admin@demo.test / password123
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'admin@demo.test',
      fullName: 'Demo Admin',
      passwordHash: await argon2.hash('password123'),
      status: 'active',
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    },
  })
  await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } })

  // Default commission rule (global 10%)
  await prisma.commissionRule.create({
    data: { organizationId: org.id, scope: 'global', type: 'percentage', value: 10, priority: 0 },
  })

  // Demo store
  const store = await prisma.store.create({
    data: { organizationId: org.id, platform: 'shopify', name: 'Demo Shopify Store', domain: 'demo.myshopify.com', status: 'connected' },
  })

  // Approved affiliate + referral link + coupon (for end-to-end testing)
  const affiliate = await prisma.affiliate.create({
    data: { organizationId: org.id, affiliateCode: 'ABAAN001', referralSlug: 'abaan001', status: 'approved' },
  })
  await prisma.affiliateLink.create({
    data: { affiliateId: affiliate.id, storeId: store.id, destinationUrl: 'https://demo.myshopify.com', shortCode: 'AB123XY' },
  })
  await prisma.coupon.create({
    data: { storeId: store.id, affiliateId: affiliate.id, code: 'ABAAN10', discountType: 'percentage', status: 'active' },
  })

  // Affiliate portal login: affiliate@demo.test / password123
  const affiliateUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'affiliate@demo.test',
      fullName: 'Abaan (Affiliate)',
      passwordHash: await argon2.hash('password123'),
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  })
  await prisma.affiliate.update({ where: { id: affiliate.id }, data: { userId: affiliateUser.id } })

  // Demo customer + 12 days of orders/clicks/conversions/commissions so dashboards have data
  const customer = await prisma.customer.create({
    data: { organizationId: org.id, email: 'buyer@example.com', firstAffiliateId: affiliate.id },
  })
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
    // A few clicks per order for a realistic conversion rate
    for (let c = 0; c < 3; c++) {
      await prisma.click.create({ data: { affiliateId: affiliate.id, storeId: store.id, occurredAt: day } })
    }
    await prisma.conversion.create({
      data: { orderId: order.id, affiliateId: affiliate.id, attributionMethod: 'cookie', createdAt: day },
    })
    const amount = Math.round(subtotal * 10) / 100 // 10%
    const status = statuses[i % statuses.length]
    await prisma.commission.create({
      data: { orderId: order.id, affiliateId: affiliate.id, amount, currency: 'USD', status, createdAt: day, updatedAt: day },
    })
    if (status !== 'pending') lifetime += amount
  }
  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: { lifetimeEarnings: lifetime, availableBalance: lifetime },
  })

  // Payout method record for the affiliate (bank as default)
  await prisma.payoutMethodRecord.create({
    data: { affiliateId: affiliate.id, method: 'bank', isDefault: true },
  })

  // One demo approved payout so admin payouts page has data
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

  // eslint-disable-next-line no-console
  console.log('Seed complete.')
  console.log('  Affiliate portal login: affiliate@demo.test / password123')
  console.log('  Login:      admin@demo.test / password123')
  console.log('  Store ID:   ' + store.id)
  console.log('  Affiliate:  ABAAN001 (approved)  coupon: ABAAN10  link: /v1/track/r/AB123XY')
}

main().finally(() => prisma.$disconnect())
