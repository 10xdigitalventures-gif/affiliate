#!/usr/bin/env bash
# ── Affiliate Platform - PostgreSQL backup script ─────────────────────────────
#
# Usage:
#   ./scripts/backup.sh                        # take a backup now
#   ./scripts/backup.sh --restore <file.sql.gz>  # restore from a backup file
#   ./scripts/backup.sh --list                   # list available backups
#
# Environment variables:
#   DATABASE_URL       - required (PostgreSQL connection string)
#   BACKUP_DIR         - where to store backups (default: ./backups)
#   RETENTION_DAYS     - how many days to keep backups (default: 30)
#   BACKUP_PASSPHRASE  - if set, backups are encrypted with GPG AES256
#
# Schedule with cron (daily at 02:00):
#   0 2 * * * cd /app && DATABASE_URL=... BACKUP_DIR=/backups ./scripts/backup.sh
#
# RPO target: 24 hours (daily automated backup)
# RTO target: 1 hour   (documented restore procedure below)
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_URL="${DATABASE_URL:?DATABASE_URL environment variable is required}"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

case "${1:-backup}" in
  --list)
    log "Available backups in $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR"/*.sql.gz* 2>/dev/null || echo "  (none found)"
    ;;

  --restore)
    FILE="${2:?Usage: $0 --restore <backup-file>}"
    if [[ ! -f "$FILE" ]]; then
      echo "ERROR: File not found: $FILE" >&2; exit 1
    fi
    log "Starting restore from: $FILE"
    log "WARNING: This will overwrite the current database. Ctrl-C to abort."
    sleep 5
    if [[ "$FILE" == *.gpg ]]; then
      log "Decrypting backup..."
      gpg --batch --passphrase "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required for encrypted backup}" \
        --output - --decrypt "$FILE" | gunzip | psql "$DB_URL"
    else
      gunzip -c "$FILE" | psql "$DB_URL"
    fi
    log "Restore complete."
    ;;

  backup|"")
    if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
      OUTFILE="$BACKUP_DIR/affiliate_${TIMESTAMP}.sql.gz.gpg"
      log "Creating encrypted backup: $OUTFILE"
      pg_dump "$DB_URL" --no-password \
        | gzip \
        | gpg --batch --symmetric --cipher-algo AES256 \
            --passphrase "$BACKUP_PASSPHRASE" \
            --output "$OUTFILE"
    else
      OUTFILE="$BACKUP_DIR/affiliate_${TIMESTAMP}.sql.gz"
      log "Creating backup: $OUTFILE"
      pg_dump "$DB_URL" --no-password | gzip > "$OUTFILE"
      log "WARNING: backup is not encrypted. Set BACKUP_PASSPHRASE to enable encryption."
    fi

    SIZE=$(du -sh "$OUTFILE" | cut -f1)
    log "Backup saved: $OUTFILE ($SIZE)"

    # Prune old backups
    DELETED=$(find "$BACKUP_DIR" -name 'affiliate_*.sql.gz*' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
    log "Cleaned up $DELETED backup(s) older than $RETENTION_DAYS days."
    ;;

  *)
    echo "Usage: $0 [--list | --restore <file> | backup]" >&2; exit 1
    ;;
esac
