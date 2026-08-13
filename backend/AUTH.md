# Authentication & Identity

Expanded auth for the platform: session tokens with rotation, password reset,
team invitations, and account self-service. Code lives in `src/auth/`.

## Token model

- **Access token** — short-lived JWT (default 15 min, `JWT_ACCESS_TTL`). Sent as
  `Authorization: Bearer <token>`. Signed with `JWT_ACCESS_SECRET`.
- **Refresh token** — opaque 256-bit random string (default 7 days,
  `JWT_REFRESH_TTL`). Only its SHA-256 hash is stored (`RefreshToken.tokenHash`),
  so a database leak never exposes usable tokens.

### Rotation + reuse detection

Every `/auth/refresh` **rotates**: a new refresh token is issued and the old one
is revoked (`revokedAt` set, `replacedByTokenId` linked). If a token that has
already been rotated is presented again, this is treated as a **breach** and
**all** of that user's active refresh tokens are revoked. Password changes and
resets also revoke every active session.

## Endpoints (`/v1/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/login` | public | 5/min per IP. Returns access + refresh + user. |
| POST | `/refresh` | public (token) | Rotates the refresh token. |
| POST | `/logout` | access token | Revokes the presented refresh token. |
| POST | `/logout-all` | access token | Revokes every session for the user. |
| GET | `/me` | access token | Current user + permissions. |
| POST | `/change-password` | access token | Verifies current password, revokes other sessions. |
| POST | `/forgot-password` | public | 5/min. Always returns `{ok:true}` (no email enumeration). |
| POST | `/reset-password` | public (token) | One-time token, 1h TTL. |
| POST | `/invitations` | `settings.write` | Invite a teammate (optional role). |
| POST | `/accept-invite` | public (token) | Set password, activate account, auto-login. |

## Invitations

`POST /invitations` creates a placeholder `invited` user (if one doesn't already
exist) and emails a tokenized accept link. `POST /accept-invite` sets the
password, marks the account `active` + email-verified, attaches the invited role,
and issues tokens so the user is logged straight in. Invite tokens are hashed,
single-use, and expire after `INVITE_TTL` (default 7 days).

## Password reset

`forgot-password` creates a hashed, single-use `PasswordResetToken` (1h TTL) and
emails a link. `reset-password` consumes it, updates the hash (argon2), and
invalidates other outstanding reset tokens and all sessions. Responses never
reveal whether an email exists.

## Account states

`UserStatus`: `invited` (cannot log in until accepted), `active`, `suspended`
(login blocked). Login updates `lastLoginAt`.

## Security notes

- Passwords hashed with **argon2**; tokens hashed with **SHA-256** (high entropy).
- Login, refresh, forgot/reset, and accept endpoints are throttled.
- New tables: `RefreshToken`, `PasswordResetToken`, `Invitation`
  (migration `20260710_auth_tokens`). Run `npx prisma migrate deploy` (or
  `migrate dev`) and `npx prisma generate` locally.

## Web client (`web/lib/api.ts` → `Auth`)

`Auth.login / refresh / logout / logoutAll / me / changePassword /
forgotPassword / resetPassword / invite / acceptInvite`. Access + refresh tokens
are persisted in `localStorage` (`token`, `refresh_token`).

## Tests

`src/auth/auth.service.spec.ts` — login token issuance & hashing, refresh
rotation, reuse-detection breach revocation, single-session logout,
invited/suspended login block, password-reset consume + no-reuse, invite accept
& expiry.
