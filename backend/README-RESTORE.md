# Restore all tables (schema.prisma se generated)

> **Legacy disaster-recovery reference only.** Normal v6 deployment must use
> `npm run db:prepare` followed by `npx prisma migrate deploy`. `db push` below
> is only for rebuilding an empty database after a verified backup; never use it
> as a production deployment fallback.

Aap ki DB ki saari tables drop ho gayi theen. Ye package un sab ko wapas banata hai.
(30 enums + 45 tables + 56 indexes + 68 foreign keys.)

## Sabse aasan tareeqa (Supabase SQL Editor)
1. Supabase Dashboard -> SQL Editor -> New query
2. `RESTORE-ALL-TABLES.sql` ka poora content paste karo
3. Run. Saari tables + RLS ek saath ban jayengi.
4. Phir seed: local terminal me `npm run seed`  (ya `npx prisma db seed`)

> Ye sirf khaali tables banata hai. Purana DATA sirf Supabase backup se aayega
> (Dashboard -> Database -> Backups).

## Prisma ke through (alternative)
Sab se saaf: schema se seedha sync karo (migration history ki zaroorat nahi):
```powershell
npx prisma db push
npm run seed
```
Ya migration history bhi chahiye to `prisma/migrations/0_init/` folder project me daal ke:
```powershell
npx prisma migrate resolve --applied 0_init   # agar db push se bana chuke ho
# warna:
npx prisma migrate deploy
```

## Files
- `RESTORE-ALL-TABLES.sql`  -> tables + RLS, one paste (Supabase SQL Editor)
- `prisma/migrations/0_init/migration.sql`  -> sirf tables (CREATE)
- `prisma/migrations/1_enable_rls_supabase/migration.sql` -> sirf RLS
- `RLS-tenant-isolation-OPTIONAL.sql` -> advanced per-row tenant isolation (optional)
