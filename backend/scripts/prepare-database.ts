import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COMPATIBILITY_ROLES = ['anon', 'authenticated'] as const

async function main() {
  const rows = await prisma.$queryRaw<Array<{ rolname: string }>>`
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  `
  const existing = new Set(rows.map((row) => row.rolname))

  for (const role of COMPATIBILITY_ROLES) {
    if (existing.has(role)) continue
    try {
      // These NOLOGIN roles exist only so the historical Supabase hardening
      // migration is portable to ordinary PostgreSQL. The migration revokes
      // all rights from them; the application never authenticates as them.
      await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`)
      console.log(`Created locked compatibility role: ${role}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Database role "${role}" is missing and the DATABASE_URL user cannot create it. ` +
        `Ask the database administrator to run CREATE ROLE ${role} NOLOGIN, then retry. ${detail}`,
      )
    }
  }

  console.log('Database migration prerequisites are ready.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
