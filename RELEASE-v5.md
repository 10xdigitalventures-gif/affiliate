# Affiliate Platform v5 security release

This release keeps every v4 authentication, profile and affiliate-portal feature
and adds a production-safe administrator bootstrap plus supported dependencies.

## Security changes

- Removed all hard-coded demo emails and passwords from `prisma/seed.ts`.
- The seed and `npm run admin:ensure` are repeatable and update the same account
  instead of creating duplicate roles or users.
- Administrator passwords must have 12 or more characters, including upper and
  lower case letters, a number and a symbol.
- The Windows deployment asks for the password as a masked `SecureString`, passes
  it to Node only through the current process environment, and never writes or
  prints it.
- Re-running the bootstrap resets the selected administrator password, grants the
  system Admin role, activates super-admin access and revokes previous sessions.
- The old demo customer, order and shared-password accounts are no longer inserted
  into production databases.
- Backend, dashboard and marketing lockfiles report zero known npm audit
  vulnerabilities at release time.
- Clean installs no longer print the previous deprecated `glob`, `inflight`,
  `npmlog`, `gauge`, `rimraf`, `supertest` or `tar` package warnings.

## Supported runtime upgrades

- Node.js minimum: `20.11.0`
- Next.js: `15.5.20`
- NestJS: `11.1.28`
- Prisma: `6.19.3`
- Argon2: `0.44.0`
- Nodemailer: `9.0.3`
- Jest: `30.4.2`

The nested PostCSS dependency used by Next is pinned to patched `8.5.19`.

## Cloudflare maintenance

`deploy/update-cloudflared-windows.ps1` validates the existing local ingress
configuration when present, stops only the `cloudflared` service, runs the official
updater, restores Automatic startup and confirms that the service remains running.
It preserves the existing tunnel UUID, credentials, ingress rules and DNS routes.

The main Windows replacement script runs this updater automatically after a
successful Affiliate Platform deployment. Use `-SkipCloudflaredUpdate` only when
Cloudflare is intentionally maintained by another process.

## Super-admin login

The deployment command supplies the email and prompts for a new masked password:

```powershell
-AdminEmail "abaanshujat@gmail.com" -AdminName "Platform Admin"
```

After deployment, sign in at:

`https://affiliate.mentoringhub.online/login`

The selected user opens `/admin`; normal tenant users open `/dashboard`, and
approved affiliate users open their private `/portal`.

Do not run `prisma migrate resolve` or `-BaselineExistingDatabase` on the existing
v4 installation. Its migration history is already established.
