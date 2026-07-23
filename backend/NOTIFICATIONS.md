# Notifications

In-app + email notifications for key affiliate lifecycle events.

## What triggers a notification

| Event | In-app recipient | Type | Email (existing) |
|-------|------------------|------|------------------|
| Commission approved | The affiliate's linked user | `commission.approved` | `commissionApproved` |
| Payout marked paid / sent | The affiliate's linked user | `payout.sent` | `payoutSent` |
| New affiliate application | All org users with `affiliates.write` | `application.new` | `newApplicationAlert` (to `MAIL_ADMIN_EMAIL`) |

Notifications are **best-effort**: `NotificationsService.record()` swallows DB errors and
notify helpers are called with `.catch(() => {})`, so a notification failure never breaks
commission approval, payouts, or signups.

> Note: affiliates created from applications do not always have a linked `user`
> (`Affiliate.userId` may be null). `notifyUser` no-ops when the recipient is null, so
> those affiliates simply won't get an in-app row until a user account is linked.

## Data model

`Notification` (Prisma):

- `id`, `organizationId`, `recipientUserId?`
- `type` (string, e.g. `commission.approved`)
- `channel` (`NotificationChannel` — `email | in_app | webhook`, default `in_app`)
- `title`, `body?`, `data?` (JSON payload, e.g. `{ commissionId, amount, currency }`)
- `readAt?`, `createdAt`
- Indexes: `@@index([organizationId])`, `@@index([recipientUserId, readAt])`

Migration: `prisma/migrations/20260711_notifications/migration.sql`.

## API

All routes require a logged-in user (JWT). A user only ever sees their **own** notifications
(scoped by `req.user.sub` + `organizationId`); no extra permission is needed.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/notifications?unreadOnly=&limit=` | List (newest first, limit capped at 200) |
| GET | `/v1/notifications/unread-count` | `{ count }` for the bell badge |
| POST | `/v1/notifications/:id/read` | Mark one read (idempotent) |
| POST | `/v1/notifications/read-all` | Mark all read → `{ updated }` |

## Preferences

Stored per-org in `Organization.settings.notifications`:

```json
{ "inAppEnabled": true, "emailEnabled": true }
```

- `inAppEnabled: false` → `notifyUser` / `notifyOrgAdmins` skip creating in-app rows.
- `emailEnabled` is stored and surfaced in the UI; existing mail sends remain unchanged
  (reserved for a future global email gate).

Managed via `GET`/`PATCH /v1/settings/notifications` (permission `settings.write`) and the
**Settings → Notifications** card in the dashboard.

## Frontend

- **Bell dropdown** (`components/shell/notification-bell.tsx`): polls unread count every 30s,
  shows the 10 latest on open, optimistic mark-read / mark-all-read, badge caps at `9+`.
- **Full page** (`/notifications`): All / Unread filter, mark read, mark all read.
- **API client** (`lib/api.ts`): `Notifications` + `NotificationSettings` helpers.

## Verify locally

The build sandbox has no `node_modules` / Prisma CLI / network, so type-checking and
migrations must be run locally:

```bash
cd backend
npm install
npx prisma migrate deploy   # applies 20260711_notifications
npx prisma generate
npm run build
npm test -- notifications
```
