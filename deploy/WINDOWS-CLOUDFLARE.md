# Windows 11 deployment — Affiliate Platform v7.2

Current public routes:

| URL | Local service |
|---|---|
| `https://affiliate.mentoringhub.online/v1/*` | API on `127.0.0.1:4100` |
| `https://affiliate.mentoringhub.online/*` | App on `127.0.0.1:3100` |
| `https://web.mentoringhub.online/*` | Marketing on `127.0.0.1:3002` |

The existing JIL routes (`app`, `api`, `marketplace`) and `wa-client-hub` are
unrelated and remain untouched.

## Direct replacement command

Put `Affiliate-Platform-mentoringhub-portal-v7.2.zip` in Downloads. Open a new
**Administrator PowerShell** and paste the whole block. It is safe even if
another shell or Explorer window is inside `E:\Programs\Affiliate-Platform-Live`:
the live root directory is no longer moved or renamed.

```powershell
$ErrorActionPreference = "Stop"
Set-Location $env:USERPROFILE

$Zip = Get-ChildItem `
  "$env:USERPROFILE\Downloads\Affiliate-Platform-mentoringhub-portal-v7.2*.zip" `
  -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $Zip) { throw "v7.2 ZIP Downloads folder me nahi mili." }

Write-Host "Using $($Zip.FullName)" -ForegroundColor Cyan
Get-FileHash -LiteralPath $Zip.FullName -Algorithm SHA256 | Format-List

$Stage = "$env:TEMP\Affiliate-v72-Deploy-$(Get-Date -Format yyyyMMddHHmmss)"
Expand-Archive -LiteralPath $Zip.FullName -DestinationPath $Stage -Force

& powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "$Stage\deploy\windows-replace-and-deploy.ps1" `
  -ZipPath $Zip.FullName `
  -InstallPath "E:\Programs\Affiliate-Platform-Live" `
  -AdminEmail "abaanshujat@gmail.com" `
  -AdminName "Demo Admin"

if ($LASTEXITCODE -ne 0) { throw "v7.2 deployment fail hua; red error bhejna." }

pm2 status
Write-Host "Login: https://affiliate.mentoringhub.online/login" -ForegroundColor Green
```

The password prompt is masked. Use at least 12 characters with upper/lowercase,
a number and a symbol. It is passed only through the deployment process and is
not stored in the ZIP, `.env`, PowerShell history or console output.

## What the deployer guarantees

- Extracts, installs, migrates and builds in a temporary candidate directory.
- Runs the locked database-role compatibility preflight before applying the
  immutable migration history; a migration error is never replaced by `db push`.
- Disables stale incremental TypeScript output and verifies `dist\main.js` plus
  other required backend artifacts before stopping the live application.
- Mirrors the existing live contents to a timestamped rollback directory.
- Synchronizes candidate **contents** into the existing live directory, so an
  open current-directory handle cannot block deployment.
- Preserves `backend\.env` and frontend production environment files.
- Stops/replaces only `affiliate-backend`, `affiliate-web` and
  `affiliate-marketing`; old JIL and WA processes are untouched.
- Waits for API readiness (PostgreSQL + Redis), app and marketing endpoints.
- Updates/restarts only the existing `cloudflared` Windows service and preserves
  its tunnel UUID, credentials, ingress rules and DNS.
- Runs public URL verification and production dependency audits.
- Prints completion only if every required check passes.
- On cutover failure, mirrors the previous files back and restarts the previous
  Affiliate PM2 release automatically.

The database migrations are additive. If a candidate fails after a migration,
the previous app files are restored; normal database backups should still be
kept for production disaster recovery.

## Existing database baseline

Do not pass `-BaselineExistingDatabase` on a database with established Prisma
migration history (including the currently working installation). Use it only
for a legacy database that already exactly matches the initial schema but has no
Prisma history; the script verifies the schema before recording `0_init`.

## Cloudflare rules

Your existing named tunnel already owns these DNS records. Its ingress rules
must remain in this order:

1. `affiliate.mentoringhub.online`, path `^/v1(/.*)?$` → `http://localhost:4100`
2. `affiliate.mentoringhub.online`, no path → `http://localhost:3100`
3. `web.mentoringhub.online`, no path → `http://localhost:3002`
4. Existing JIL `app/api/marketplace` rules remain unchanged
5. Final `http_status:404` catch-all

The v6 deploy does not recreate DNS records. It validates and preserves the
already-working tunnel configuration, then runs `cloudflared update` and checks
that the Automatic Windows service reconnects.

## Manual verification

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "E:\Programs\Affiliate-Platform-Live\deploy\verify-windows.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "E:\Programs\Affiliate-Platform-Live\deploy\security-check-windows.ps1"

pm2 logs affiliate-backend --lines 100
```
