# Status Page Setup

## Overview

The `/v1/health` endpoint (provided by `HealthModule`) is the canonical
liveness + readiness probe. It checks:

- API server reachability
- PostgreSQL connectivity (via Prisma `$queryRaw SELECT 1`)
- Redis connectivity (via `PING`)

Response format:
```json
{ "status": "ok", "checks": { "db": "up", "redis": "up" } }
```

## Recommended: Instatus or Statuspage.io

1. Create a free account at [instatus.com](https://instatus.com) or
   [statuspage.io](https://www.atlassian.com/software/statuspage).
2. Add an **HTTPS uptime check** pointing to:
   ```
   GET https://api.yourcompany.com/v1/health
   ```
   - Interval: 1 minute
   - Expected status: 200
   - Timeout: 10 seconds
3. Add components matching your architecture:
   - API (backend)
   - Database
   - Job queue
   - Frontend (web app)
4. Configure **subscriber notifications** (email / Slack) for incidents.
5. Embed the status badge in your docs / support portal.

## Automated incident creation

Use Instatus / Statuspage webhook integration to auto-create incidents when
the health check fails and auto-resolve when it recovers.

## Manual status updates

During a planned maintenance window, create a "Scheduled Maintenance" notice
at least 24 hours in advance to notify subscribers.
