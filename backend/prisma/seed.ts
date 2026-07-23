import { PrismaClient } from '@prisma/client'
import { ensureSuperAdmin, loadLocalEnv } from '../scripts/admin-bootstrap'

loadLocalEnv()

const prisma = new PrismaClient()

/**
 * Production-safe, repeatable seed.
 *
 * It intentionally creates no shared demo passwords, orders or customer data.
 * Supply the administrator credentials through process-scoped environment
 * variables; the deployment script does this without writing the password to
 * disk or putting it in the command line.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || process.env.ADMIN_EMAIL || ''
  const password = process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ''

  const { user, organization } = await ensureSuperAdmin(prisma, {
    email,
    password,
    fullName: process.env.SEED_ADMIN_NAME || process.env.ADMIN_NAME,
    organizationSlug: process.env.SEED_ADMIN_ORG_SLUG || process.env.ADMIN_ORG_SLUG,
    organizationName: process.env.SEED_ADMIN_ORG_NAME || process.env.ADMIN_ORG_NAME,
  })

  console.log('Secure seed completed.')
  console.log(`Super-admin login email: ${user.email}`)
  console.log(`Organization: ${organization.name} (${organization.slug})`)
  console.log('No password was stored in source code or printed to the console.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
