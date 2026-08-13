# Migration reset (baseline) + Supabase RLS — step by step

Do the steps in order. All commands run from `E:\Programs\Affiliate-Platform\backend`.

---

## Part 1 — Fix the migration history (baseline, keeps your data)

Your `prisma/migrations` folder has NO init migration, so `migrate dev` fails
(P1014: `User` table does not exist in the shadow DB). We baseline the existing
Supabase DB against your current schema.

```powershell
# 1. move the old, incomplete migrations aside
Move-Item prisma\migrations prisma\migrations_old

# 2. generate ONE baseline migration from the full current schema
New-Item -ItemType Directory -Force prisma\migrations\0_init | Out-Null
npx prisma migrate diff `
  --from-empty `
  --to-schema-datamodel prisma\schema.prisma `
  --script | Out-File -Encoding utf8 prisma\migrations\0_init\migration.sql

# 3. tell Prisma this baseline is ALREADY applied on the live DB (runs no SQL)
npx prisma migrate resolve --applied 0_init

# 4. confirm history is clean
npx prisma migrate status
```

> If `migrate status` reports drift, your live DB does not exactly match
> schema.prisma. Send me the output and I'll adjust.

---

## Part 2 — Add the RLS migration (Supabase hardening)

Copy the folder `prisma/migrations/20260714150000_enable_rls_supabase` from this
zip into your project's `prisma/migrations/`. Then apply it:

```powershell
npx prisma migrate deploy
```

What it does:
- Enables Row Level Security on all 45 tables.
- Revokes public Data API grants (`anon`, `authenticated`).
- **Does NOT break Prisma** — the `postgres` owner role bypasses RLS (we do NOT
  use FORCE), and `service_role` has BYPASSRLS. Your NestJS backend keeps working.
- Clears the "RLS disabled in public schema" warnings in the Supabase dashboard.

---

## Part 3 (OPTIONAL) — True per-row multi-tenant isolation

File: `RLS-tenant-isolation-OPTIONAL.sql`

Only needed if you want RLS enforced even against your own backend (defense in
depth) or you plan to expose the Supabase Data API. It uses a per-transaction
setting `app.current_org_id` + `FORCE ROW LEVEL SECURITY` on the 23 org-scoped
tables. If you enable it, your backend MUST set the variable on every request:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
  // ...all tenant queries here are auto-filtered by orgId...
});
```

To apply it as a migration, drop its contents into a new migration folder
(e.g. `20260714160000_tenant_rls/migration.sql`) and run `npx prisma migrate deploy`.

---

## Alternative to Part 1 (only if the DB data is disposable)

```powershell
Remove-Item -Recurse -Force prisma\migrations
npx prisma migrate reset --skip-seed      # wipes the DB
npx prisma migrate dev --name init         # single clean init from schema
npm run seed
```
Then do Part 2.
