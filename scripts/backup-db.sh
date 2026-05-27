#!/usr/bin/env bash
# Daily Supabase backup → ./backups/relay-green-<UTC-timestamp>.dump
# Invoked from cron (see crontab -l). Reads DB_URL from ~/.relay-green-backup.env.
set -euo pipefail

REPO_DIR="/home/devsoni/Pictures/relay/Relay.green"
BACKUP_DIR="${REPO_DIR}/backups"
ENV_FILE="${HOME}/.relay-green-backup.env"
DOCKER_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.106"
RETENTION_DAYS=14
LOG="${BACKUP_DIR}/backup.log"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "FATAL: ${ENV_FILE} missing or unreadable" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${ENV_FILE}"
: "${DB_URL:?DB_URL must be set in ${ENV_FILE}}"

mkdir -p "${BACKUP_DIR}"
TS=$(date -u +%Y%m%d-%H%M%SZ)
OUT_REL="relay-green-${TS}.dump"
OUT_ABS="${BACKUP_DIR}/${OUT_REL}"

{
  echo "===== $(date -Is) backup start → ${OUT_REL} ====="

  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "${BACKUP_DIR}:/backups" \
    --entrypoint pg_dump \
    "${DOCKER_IMAGE}" \
    "${DB_URL}" \
    --format=custom --no-owner --no-acl \
    --file="/backups/${OUT_REL}"

  SIZE=$(du -h "${OUT_ABS}" | cut -f1)
  echo "wrote ${OUT_REL} (${SIZE})"

  # Retention: drop dumps older than RETENTION_DAYS days
  REMOVED=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'relay-green-*.dump' \
              -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
  if [[ "${REMOVED}" -gt 0 ]]; then
    echo "pruned ${REMOVED} old dump(s) older than ${RETENTION_DAYS}d"
  fi

  echo "===== $(date -Is) backup done ====="
} >>"${LOG}" 2>&1
