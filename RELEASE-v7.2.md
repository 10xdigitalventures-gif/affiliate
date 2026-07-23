# Affiliate Platform v7.2 — Organizations, Plans and Email Login

v7.2 combines the complete v7.1 partner portal and secure email-code login with
the missing super-admin organization onboarding and plan-control workflow.

## Super-admin organization onboarding

- **Organizations → New organization** creates an isolated tenant workspace.
- The operator sets workspace name/ID, owner name/email, currency and status.
- A plan can be assigned during creation or later from the organization detail page.
- No shared/default password is generated. The new owner receives a one-time
  email code and activates their own account after proving email ownership.
- Creation, plan assignment and lifecycle changes remain super-admin-only and audited.

## Plans, features and enforced limits

- Plans can be created, edited, archived and assigned from the super-admin portal.
- Limits include affiliates, stores, team members, API keys, tracking links per
  affiliate and monthly payout requests per affiliate.
- Optional plan features include API access, webhooks, fraud tools, multi-tier
  commissions, reports, bulk operations, branding, custom domains and SSO.
- Organization detail displays resolved entitlements and current global usage.
- Link and payout action limits are checked by the backend, not only hidden in the UI.
- `-1` means unlimited; canceled/expired subscriptions fall back to safe limits.

## Authentication and deployment

- Email → six-digit code remains the default login for all roles.
- Codes are single-use, attempt-limited, short-lived and stored as keyed hashes.
- Password and enterprise SSO remain optional fallback methods.
- Migration `5_plan_action_limits` adds new built-in-plan JSON limits without
  overwriting platform-owner custom values.
- The existing Windows transactional cutover, rollback, PM2 isolation and
  Cloudflare verification flow is preserved.

## Coupon, link and public-URL management

- Tenant admins can create individual coupons, bulk-generate codes, enable or
  disable them, and permanently delete unused coupons from **Links & Coupons**.
- Coupons with attributed orders cannot be deleted; disabling them preserves
  financial and attribution history.
- Affiliates can create, copy, open and delete their own unused tracking links.
  Links with recorded clicks are retained for reporting integrity.
- Windows deployment now normalizes every externally shared application, API,
  tracking, Shopify and billing-webhook URL to the live MentoringHub HTTPS host.

## Repository hygiene

- The root `.gitignore` excludes dependencies, build output, runtime files,
  environment secrets, credentials, logs, backups and deployment diagnostics
  while retaining every documented `.env*.example` template.

## Dual-role administration and tenant onboarding

- A user who is both platform super admin and organization admin can move
  between **Platform console** and **Organization dashboard** without a redirect
  loop. The account dropdown exposes the appropriate switch in both areas.
- Tenant creation pre-provisions global permissions before the database
  transaction and uses a remote-database-safe transaction window.
- Workspace/owner uniqueness races return a clear conflict response instead of
  an opaque 500 error.
- An SMTP outage no longer hides or rolls back a successfully created tenant.
  The console reports that the organization exists and tells the owner to
  request a fresh email code from the sign-in page.
