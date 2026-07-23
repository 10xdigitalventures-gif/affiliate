# Affiliate Platform deployment

## Windows 11 (current team-testing target)

Use [`WINDOWS-CLOUDFLARE.md`](WINDOWS-CLOUDFLARE.md). It contains the exact
PowerShell block for replacing `E:\Programs\Affiliate-Platform-Live`, clean builds,
database migration, PM2 restart and Cloudflare Tunnel routing.

Live layout:

| Public URL | Local PM2 service |
|---|---|
| `https://affiliate.mentoringhub.online/v1/*` | `affiliate-backend` on `127.0.0.1:4100` |
| `https://affiliate.mentoringhub.online/*` | `affiliate-web` on `127.0.0.1:3100` |
| `https://web.mentoringhub.online/*` | `affiliate-marketing` on `127.0.0.1:3002` |

Files:

- `windows-replace-and-deploy.ps1` — backup, replace, migrate, secure admin
  bootstrap, build, PM2 start and Cloudflare update
- `update-cloudflared-windows.ps1` — safely updates only the existing Cloudflare
  Tunnel Windows service without changing routes or credentials
- `security-check-windows.ps1` — checks Node.js, all three npm lockfile audits,
  and the Cloudflare service state

For an existing database that already matches `schema.prisma` but has no Prisma
migration history, pass `-BaselineExistingDatabase` only on its first deployment.
An installation with existing Prisma history must not use that switch; every
pending migration is applied normally by `prisma migrate deploy`.
- `verify-windows.ps1` — checks all local and public URLs
- `cloudflared/config.windows.yml` — locally-managed Windows tunnel template
- `ecosystem.config.js` — PM2 definitions for all three apps

## Final Linux server

Use [`SERVER-DEPLOY.md`](SERVER-DEPLOY.md) for the immutable Docker deployment,
tagged rollback, private Redis, admin bootstrap and dedicated server tunnel.
This is prepared for the final move; it does not change the current Windows
team-sharing environment.
