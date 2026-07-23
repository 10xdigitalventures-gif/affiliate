# CI / CD (GitHub Actions)

Workflows live in `.github/workflows/`.

## `ci.yml` — on push & PR to main/master/develop

Three parallel jobs:

### `backend`
- Spins up a **Postgres 16** service container (health-checked).
- `npm ci` → `prisma generate` → database-role preflight → `prisma migrate deploy`.
- Migration failure is fatal; CI never hides it with `db push`.
- `npm run typecheck` → `npm run build` → `npm test` (Jest, `--ci --runInBand`).
- Env: `DATABASE_URL`, `ENCRYPTION_KEY`, and distinct JWT secrets (test values).

### `web`
- `npm ci` → `npm run typecheck` → `npm run build` (Next.js).
- Uses npm cache keyed on `web/package-lock.json`.

### `marketing`

- Independently installs, typechecks and builds the public marketing site.
- Uses npm cache keyed on `marketing/package-lock.json`.

Concurrency: in-progress runs for the same ref are cancelled when a new commit lands.

## `docker.yml` — on push to main/master, tags `v*`, and PRs

- Matrix over `backend`, `web` and `marketing`.
- Buildx + `docker/build-push-action` with **GitHub Actions cache** (`type=gha`).
- `push: false` by default — builds/validates images without publishing. To publish,
  add a registry login step and set `push: true` (see commented pattern below).

```yaml
# - name: Login to GHCR
#   uses: docker/login-action@v3
#   with:
#     registry: ghcr.io
#     username: OWNER
#     password: TOKEN   # use a repo secret
```

## `dependabot.yml`

Weekly dependency PRs for `/backend`, `/web`, `/marketing` (npm) and root GitHub
Actions, grouped as minor/patch to reduce noise.

## Notes

- Requires `package-lock.json` in each Node project for `npm ci` +
  cache. Generate locally with `npm install` and commit the lockfiles.
- The full immutable Prisma history is in `backend/prisma/migrations/`.
