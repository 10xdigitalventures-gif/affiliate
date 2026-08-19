# Backup and Disaster Recovery Runbook

## Targets

| Metric | Target |
|--------|--------|
| RPO (Recovery Point Objective) | 24 hours |
| RTO (Recovery Time Objective) | 1 hour |

## Automated backups

Schedule `scripts/backup.sh` to run daily via cron or a platform job:

```bash
# Add to crontab (daily at 02:00 UTC)
0 2 * * * cd /app && \
  DATABASE_URL="$DATABASE_URL" \
  BACKUP_DIR=/mnt/backups \
  BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" \
  ./scripts/backup.sh >> /var/log/affiliate-backup.log 2>&1
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BACKUP_DIR` | Where to write backup files (use off-site storage in production) |
| `BACKUP_PASSPHRASE` | GPG passphrase for AES-256 encryption (strongly recommended) |
| `RETENTION_DAYS` | How many days to keep local backups (default: 30) |

## Off-site storage

Mount a network volume or use `rclone` / `aws s3 cp` after the backup script
completes to push the file to S3, GCS, or another provider.

## Restore procedure (disaster recovery drill)

1. Spin up a clean PostgreSQL instance.
2. Set `DATABASE_URL` to the new instance.
3. Run the restore:

```bash
# Encrypted backup:
BACKUP_PASSPHRASE=... ./scripts/backup.sh --restore ./backups/affiliate_20260101_020000.sql.gz.gpg

# Unencrypted backup:
./scripts/backup.sh --restore ./backups/affiliate_20260101_020000.sql.gz
```

4. Run Prisma migrations to ensure schema is up to date:

```bash
npx prisma migrate deploy
```

5. Smoke-test the restored database:
   - Log in as a super admin.
   - Verify tenant data is scoped correctly.
   - Check that commissions and payouts are intact.

6. Update DNS / load-balancer config to point to the new instance.

## Verifying backups

Run a restore drill at least monthly in a clean environment. Record the result
(timestamp, file used, time to restore, any issues found) in the incident log.
