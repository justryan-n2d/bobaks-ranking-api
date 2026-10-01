#!/usr/bin/env bash
set -euo pipefail

: "${BOBAKS_B2_ENDPOINT:?Set BOBAKS_B2_ENDPOINT to the Backblaze B2 S3 endpoint}"
: "${BOBAKS_B2_BUCKET:?Set BOBAKS_B2_BUCKET to the backup bucket name}"
: "${BOBAKS_B2_ACCESS_KEY_ID:?Set BOBAKS_B2_ACCESS_KEY_ID}"
: "${BOBAKS_B2_SECRET_ACCESS_KEY:?Set BOBAKS_B2_SECRET_ACCESS_KEY}"
: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY}"
: "${RESTORE_DB_URL:?Set RESTORE_DB_URL to a disposable or recovery Postgres database}"

OBJECT_KEY="${1:-}"
if [[ -z "${OBJECT_KEY}" ]]; then
  echo "Usage: OBJECT_KEY=... RESTORE_DB_URL=... ./scripts/restore-backup.sh <b2-object-key>" >&2
  exit 2
fi

export AWS_ACCESS_KEY_ID="${B2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${B2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${BOBAKS_B2_REGION}"

case "${RESTORE_DB_URL}" in
  *zhrfozouzvxhpkylmpwh*)
    echo "Refusing to restore into the Bobaks production Supabase project." >&2
    exit 1
    ;;
esac

if [[ "${OBJECT_KEY}" != *.enc ]]; then
  echo "Expected an encrypted .enc backup object." >&2
  exit 2
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

ENCRYPTED="${WORK_DIR}/backup.dump.enc"
DUMP="${WORK_DIR}/backup.dump"

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is required." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required." >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "PostgreSQL client tools are required." >&2
  exit 1
fi

echo "Downloading encrypted backup..."
aws s3 cp   "s3://${B2_BUCKET}/${OBJECT_KEY}"   "${ENCRYPTED}"   --endpoint-url "${B2_ENDPOINT}"   --no-progress

echo "Decrypting backup..."
openssl enc   -d   -aes-256-cbc   -pbkdf2   -iter 310000   -in "${ENCRYPTED}"   -out "${DUMP}"   -pass env:BACKUP_ENCRYPTION_KEY

echo "Checking backup structure..."
pg_restore --list "${DUMP}" >/dev/null

echo "Restoring public schema data into the recovery target..."
pg_restore   --data-only   --no-owner   --no-acl   --exit-on-error   --single-transaction   --dbname="${RESTORE_DB_URL}"   "${DUMP}"

echo "Restore completed successfully."
