# Affiliate Platform v7 — Partner Portal Completion

This release completes the missing affiliate self-service workflows while preserving the existing Windows, PM2, Cloudflare Tunnel, and future Linux/server deployment paths.

### v7.1 Windows deployment hotfix

- Stops orphaned Next.js/Node child processes that still own the affiliate ports after PM2 exits.
- Waits for ports 3100, 3002, and 4100 to be released before mirroring the candidate build.
- Uses longer bounded Robocopy retries for transient Windows Defender/file-lock delays.
- Process cleanup is restricted to this install path and the three affiliate ports; JIL and WA applications are not touched.
- `node_modules` is excluded from Robocopy mirroring to avoid Windows code 11 failures.
- Existing dependency trees are moved atomically into the rollback directory.
- Fresh dependencies are installed from the release lockfiles after source cutover.
- Automatic rollback restores both the previous source and its matching dependencies.
- Failed commands now show their complete command line and exit code.
- Robocopy failures print the detailed final log section in the terminal.
- Full deployment and Robocopy error details are retained under `Downloads\Affiliate-Deploy-Error-<timestamp>`.
- Cloudflared's informational stderr output is parsed correctly instead of being treated as a PowerShell failure.
- A non-critical updater warning no longer rolls back a healthy app; public tunnel verification remains mandatory.
- Next.js tracing roots are explicit, removing false multiple-lockfile workspace warnings on Windows.

### v7.1 email-code sign-in

- Email is now the default sign-in method; users receive a six-digit one-time code.
- Codes expire after 10 minutes, are stored only as keyed hashes, allow five attempts, and are consumed atomically.
- Request responses do not reveal whether an account exists, and request/verify endpoints are rate limited.
- A successful email verification activates an invited account and routes super-admins, staff, and affiliates to their own portal.
- Existing authenticator 2FA still runs after email verification when enabled.
- Password and enterprise SSO remain available as explicit fallback options.
- Tenant administrators can customize and preview the branded sign-in-code email.
- Password changes, password resets, and account deletion revoke pending email codes.

## Partner portal

- Affiliates can create secure tracking links from **My links**.
- Optional custom short codes and UTM parameters are supported.
- Generated links can be copied or opened directly.
- Unused links can be deleted; links with recorded clicks are retained for reporting integrity.
- Assigned coupons and offers are visible in a dedicated portal page.
- Payout requests require a saved payout method.
- Affiliates can select a default payout method.
- A mobile bottom navigation makes all portal areas accessible on small screens.

## Security and tenancy

- Affiliate identity and tenant are always taken from the authenticated JWT.
- An affiliate cannot create, list, or delete another affiliate's links.
- Link destinations must use HTTPS and belong to a connected store in the same workspace.
- Link creation is rate limited and capped per affiliate.
- Workspace admins can disable affiliate self-service link creation in Settings.
- Coupon, payout method, and portal data queries remain scoped to the signed-in affiliate.

## Deployment

- The current Windows deployer defaults to `Affiliate-Platform-mentoringhub-portal-v7.2.zip`.
- Candidate builds happen outside the live directory.
- The existing `.env` files are preserved.
- PM2 apps, Cloudflare Tunnel verification, rollback copy, and post-deployment security checks remain included.

Migration `4_email_code_login` adds the short-lived email challenge records. The
deployment script applies it automatically with the existing additive-migration
workflow.
