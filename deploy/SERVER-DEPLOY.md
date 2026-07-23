# Final Linux server deployment

The current Windows 11 + PM2 + Cloudflare setup remains the supported team-test
environment. Use this flow only when finalizing the move to a Linux server.

## One-time preparation

Install Docker Engine with the Compose plugin, upload/extract the release, then:

```bash
cd /opt/affiliate-platform
cp .env.server.example .env.server
cp backend/.env.server.example backend/.env
chmod 600 .env.server backend/.env
```

Edit both files. Use the existing production `DATABASE_URL` if PostgreSQL stays
managed (for example Supabase). Generate three different application secrets
and one Redis password:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

The same Redis password must appear in `.env.server` and `backend/.env`.

## Deploy or upgrade

```bash
bash deploy/server-install.sh
```

On the first deployment, or when intentionally resetting the platform admin:

```bash
bash deploy/server-install.sh \
  --bootstrap-admin \
  --admin-email abaanshujat@gmail.com \
  --admin-name "Demo Admin"
```

The password is read silently and is not added to shell history or a file. The
script builds tagged immutable images, applies migrations, starts the release,
checks PostgreSQL/Redis and all three local services, and records the good tag.
If application health fails, it restarts the previously recorded image tag.
Database migrations are additive and are not reversed by an application image
rollback; take normal managed-database backups before every final production
deployment.

The migration container first runs `npm run db:prepare`. On ordinary PostgreSQL
it creates two locked `NOLOGIN`/zero-access compatibility roles required by the
historical Supabase hardening migration; on Supabase they already exist. If the
database account cannot create a missing role, the deploy stops before changing
the schema and prints the exact one-time command for the database administrator.

## Cloudflare cutover

Create a dedicated server tunnel using `deploy/cloudflared/config.server.yml`.
Move only these DNS hostnames to it:

- `affiliate.mentoringhub.online`
- `web.mentoringhub.online`

Do not delete or edit the existing JIL hostnames (`app`, `api`, `marketplace`) or
the Windows `wa-client-hub` process. Once the new tunnel is connected:

```bash
bash deploy/server-verify.sh --public
```

All containers bind only to `127.0.0.1`; expose them through Cloudflare Tunnel
or the included Nginx origin config, not through public firewall ports.
