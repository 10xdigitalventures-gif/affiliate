import { PrismaClient } from '@prisma/client'
import { ensureSuperAdmin, loadLocalEnv } from './admin-bootstrap'

loadLocalEnv()

const prisma = new PrismaClient()

async function main() {
  const { user, organization } = await ensureSuperAdmin(prisma, {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
    fullName: process.env.ADMIN_NAME,
    organizationSlug: process.env.ADMIN_ORG_SLUG,
    organizationName: process.env.ADMIN_ORG_NAME,
  })

  console.log(`Super-admin account ready: ${user.email}`)
  console.log(`Organization: ${organization.name} (${organization.slug})`)
  console.log('Existing sessions were revoked; sign in with the newly supplied password.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
