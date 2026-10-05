#!/usr/bin/env bash
set -euo pipefail

: "${BOBAKS_B2_BUCKET:?Set BOBAKS_B2_BUCKET to the backup bucket name}"
: "${BOBAKS_B2_ACCESS_KEY_ID:?Set BOBAKS_B2_ACCESS_KEY_ID}"
: "${BOBAKS_B2_SECRET_ACCESS_KEY:?Set BOBAKS_B2_SECRET_ACCESS_KEY}"
: "${BOBAKS_B2_REGION:?Set BOBAKS_B2_REGION}"
: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY}"
: "${RESTORE_DB_URL:?Set RESTORE_DB_URL to a disposable or recovery Postgres database}"

OBJECT_KEY="${1:-}"
if [[ -z "${OBJECT_KEY}" ]]; then
  echo "Usage: OBJECT_KEY=... RESTORE_DB_URL=... ./scripts/restore-backup.sh <b2-object-key>" >&2
  exit 2
fi

if [[ ! "${BOBAKS_B2_REGION}" =~ ^[a-z0-9-]+$ ]]; then
  echo "Invalid Backblaze B2 region format." >&2
  exit 1
fi

BOBAKS_B2_ENDPOINT="https://s3.${BOBAKS_B2_REGION}.backblazeb2.com"

export AWS_ACCESS_KEY_ID="${BOBAKS_B2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${BOBAKS_B2_SECRET_ACCESS_KEY}"
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
DROP_FKS="${WORK_DIR}/drop-public-fks.sql"
ADD_FKS="${WORK_DIR}/add-public-fks.sql"
FKS_DROPPED=0

restore_foreign_keys_on_exit() {
  if [[ "${FKS_DROPPED}" -eq 1 && -s "${ADD_FKS}" ]]; then
    psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 -f "${ADD_FKS}" >/dev/null 2>&1 || true
  fi
}

trap 'restore_foreign_keys_on_exit; rm -rf "${WORK_DIR}"' EXIT

for command in aws openssl pg_restore psql; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

echo "Downloading encrypted backup..."
aws s3 cp "s3://${BOBAKS_B2_BUCKET}/${OBJECT_KEY}" "${ENCRYPTED}" --endpoint-url "${BOBAKS_B2_ENDPOINT}" --no-progress

echo "Decrypting backup..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 310000 -in "${ENCRYPTED}" -out "${DUMP}" -pass env:BACKUP_ENCRYPTION_KEY

echo "Checking backup structure..."
pg_restore --list "${DUMP}" >/dev/null

echo "Preparing public foreign-key definitions..."
psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 -Atqc "
  SELECT format(
    'ALTER TABLE %I.%I DROP CONSTRAINT %I;',
    n.nspname,
    c.relname,
    con.conname
  )
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
  ORDER BY n.nspname, c.relname, con.conname;
" > "${DROP_FKS}"

psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 -Atqc "
  SELECT format(
    'ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
    n.nspname,
    c.relname,
    con.conname,
    pg_get_constraintdef(con.oid)
  )
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
  ORDER BY n.nspname, c.relname, con.conname;
" > "${ADD_FKS}"

echo "Temporarily removing public foreign-key constraints..."
if [[ -s "${DROP_FKS}" ]]; then
  psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 -f "${DROP_FKS}"
  FKS_DROPPED=1
fi

echo "Restoring public schema data into the recovery target..."
pg_restore --data-only --no-owner --no-acl --exit-on-error --single-transaction --dbname="${RESTORE_DB_URL}" "${DUMP}"

echo "Creating isolated auth placeholders for public user references..."
psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users (
  id,
  aud,
  role,
  created_at,
  updated_at,
  is_anonymous,
  raw_app_meta_data,
  raw_user_meta_data
)
SELECT
  user_id,
  'authenticated',
  'authenticated',
  now(),
  now(),
  false,
  '{}'::jsonb,
  '{"bobaks_recovery_placeholder": true}'::jsonb
FROM (
  SELECT id AS user_id FROM public.profiles
  UNION
  SELECT user_id FROM public.roblox_identities
  UNION
  SELECT user_id FROM public.saved_comparisons
  UNION
  SELECT user_id FROM public.user_alert_preferences
  UNION
  SELECT user_id FROM public.user_identity_preferences
  UNION
  SELECT user_id FROM public.user_watchlist
) referenced_users
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users existing WHERE existing.id = referenced_users.user_id
);
SQL

echo "Recreating public foreign-key constraints..."
if [[ -s "${ADD_FKS}" ]]; then
  psql "${RESTORE_DB_URL}" -v ON_ERROR_STOP=1 -f "${ADD_FKS}"
  FKS_DROPPED=0
fi

echo "Restore completed successfully."
