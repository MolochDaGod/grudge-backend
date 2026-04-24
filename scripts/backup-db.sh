#!/bin/bash
# ============================================
# Grudge Backend — Database Backup (Linux/VPS)
# Cron: 0 4 * * * /opt/grudge-backend/scripts/backup-db.sh
# ============================================
set -euo pipefail

BACKUP_DIR="/backups"
RETENTION_DAYS=14
CONTAINER_NAME="grudge-backend-postgres-1"
DB_NAME="grudge_game"
DB_USER="grudge"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DIR/grudge_${TIMESTAMP}.dump"
SQL_FILE="$BACKUP_DIR/grudge_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting database backup..."

# Custom format backup (best for pg_restore)
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$DUMP_FILE"
echo "  Custom dump: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# SQL text backup (compressed, good for manual inspection)
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$SQL_FILE"
echo "  SQL dump:    $SQL_FILE ($(du -h "$SQL_FILE" | cut -f1))"

# Prune old backups
echo "  Pruning backups older than $RETENTION_DAYS days..."
deleted=$(find "$BACKUP_DIR" -name "grudge_*.dump" -mtime +$RETENTION_DAYS -delete -print | wc -l)
find "$BACKUP_DIR" -name "grudge_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "  Pruned $deleted old backup(s)"

# Show remaining backups
total=$(find "$BACKUP_DIR" -name "grudge_*.dump" | wc -l)
total_size=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "  Total backups: $total ($total_size)"

echo "[$(date)] Backup complete: $DUMP_FILE"
