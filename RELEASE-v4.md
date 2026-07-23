# Affiliate Platform v4

This release adds production authentication and account profile management.

## Included fixes

- Dashboard, affiliate portal and super-admin routes now require a valid session.
- Unauthenticated visitors are redirected to `/login`.
- The hard-coded `Demo Admin` topbar value is replaced with the signed-in user.
- The account control is aligned to the far-right and includes:
  - Profile settings
  - Logout
- Profile settings allow users to update:
  - Full name
  - Login email
  - Phone number
  - Profile picture
- Approving an affiliate application now creates or links its login account.
- New affiliates receive a one-time password setup link and then open their own
  private `/portal` area instead of the admin dashboard.
- Duplicate pending/approved applications are blocked by normalized email.
- Added migration `2_user_profile` for `phoneNumber` and `avatarUrl`.
- Added the explicit `npm run admin:ensure` utility for creating or resetting the
  first platform administrator without seeding demo orders.

## Production ports

The Affiliate Platform stays separate from the existing JIL project:

| Application | Port |
|---|---:|
| JIL web | 3000 |
| JIL marketplace | 3001 |
| Affiliate marketing | 3002 |
| JIL API | 4000 |
| Affiliate web | 3100 |
| Affiliate API | 4100 |

## Deployment

Follow `deploy/WINDOWS-CLOUDFLARE.md`. An existing v3 database must not use the
`-BaselineExistingDatabase` switch; `prisma migrate deploy` will apply only the
new profile migration.

Affiliate invitation delivery requires the production SMTP values (`MAIL_HOST`,
`MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, and `MAIL_FROM`) in `backend/.env`.
