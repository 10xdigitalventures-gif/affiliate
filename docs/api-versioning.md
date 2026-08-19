# API Versioning and Lifecycle Policy

## URL scheme

All API endpoints are prefixed with a major version:

```
https://api.example.com/v1/affiliates
https://api.example.com/v2/affiliates  ← future
```

The version is controlled by the `API_PREFIX` environment variable
(default: `v1`).

## Versioning rules

- **Non-breaking changes** (new optional fields, new endpoints) are released
  in the current version without a version bump.
- **Breaking changes** (removed fields, changed semantics, new required
  params) require a new major version (`v2`, `v3`, …).
- Old versions are maintained in parallel until the deprecation window closes.

## Deprecation timeline

| Stage | Action |
|-------|--------|
| Deprecation announced | `Deprecation` and `Sunset` headers added to all responses from the deprecated version |
| 6 months later | The version returns HTTP 410 Gone with a migration guide URL |
| 12 months later | The version is removed from the codebase |

### Example headers

```
Deprecation: Sun, 01 Dec 2026 00:00:00 GMT
Sunset: Mon, 01 Jun 2027 00:00:00 GMT
Link: <https://docs.example.com/migration/v2>; rel="deprecation"
```

## Adding a new version

1. Create `backend/src/v2/` mirroring the `v1/` module structure.
2. Register the v2 module in `AppModule` under the `v2` prefix.
3. Update the API Gateway / nginx routing to forward `/v2/*` to the new module.
4. Add `Deprecation` + `Sunset` response headers to v1 via a middleware.
5. Update this document and the OpenAPI schema.
