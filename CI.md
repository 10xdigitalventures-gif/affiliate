# CI / CD (GitHub Actions)

Workflows live in `.github/workflows/`.

## `ci.yml` — on push & PR to main/master/develop

Two parallel jobs:

### `backend`
- Spins up a **Postgres 16** service container (health-checked).
- `npm ci` → `prisma generate` → `prisma migrate deploy` (falls back to `db push`).
- `npm run lint` → `npm run build` → `npm test` (Jest, `--ci --runInBand`).
- Env: `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET` (test values).

### `web`
- `npm ci` → `npm run lint` → `npm run build` (Next.js).
- Uses npm cache keyed on `web/package-lock.json`.

Concurrency: in-progress runs for the same ref are cancelled when a new commit lands.

## `docker.yml` — on push to main/master, tags `v*`, and PRs

- Matrix over `backend` + `web`.
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

Weekly dependency PRs for `/backend`, `/web` (npm) and root GitHub Actions,
grouped as minor/patch to reduce noise.

## Notes

- Requires `package-lock.json` in each of `backend/` and `web/` for `npm ci` +
  cache. Generate locally with `npm install` and commit the lockfiles.
- The backend job needs a Prisma migration to exist; the multi-tier migration is
  already in `backend/prisma/migrations/`.
