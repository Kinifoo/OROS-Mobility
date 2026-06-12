#!/bin/bash
# OROS — Backup automatique PostgreSQL
# Ajouter dans crontab: 0 2 * * * /opt/oros-gps/scripts/backup.sh

BACKUP_DIR="/opt/oros-gps/backups"
DB_NAME="${DB_NAME:-oros_gps}"
DB_USER="${DB_USER:-oros}"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/oros_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[BACKUP] Démarrage backup $DATE"
docker exec oros-gps-postgres pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILENAME"

if [ $? -eq 0 ]; then
    SIZE=$(du -sh "$FILENAME" | cut -f1)
    echo "[BACKUP] Succès: $FILENAME ($SIZE)"
    # Nettoyer les anciens backups
    find "$BACKUP_DIR" -name "oros_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "[BACKUP] Nettoyage: backups > ${RETENTION_DAYS}j supprimés"
else
    echo "[BACKUP] ERREUR: backup échoué"
    rm -f "$FILENAME"
    exit 1
fi
