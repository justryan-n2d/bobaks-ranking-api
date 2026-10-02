# Bobaks Backup and Disaster Recovery

## Purpose

Bobaks keeps long-term ranking history in Supabase. The live database has retention controls, but long-term durability also needs an independent export that can survive a database or project failure.

The off-site archive provider for Bobaks is **Backblaze B2 Cloud Storage**. The B2 bucket is private, default encryption is enabled, and Object Lock is enabled on the bucket.

## Backup architecture

The scheduled GitHub Actions workflow:

1. Creates a logical PostgreSQL custom-format dump of the public schema.
2. Encrypts the dump with AES-256-CBC using PBKDF2 before it leaves the runner.
3. Uploads the encrypted dump and a non-secret manifest to Backblaze B2 through its S3-compatible API.
4. Keeps daily backups under `daily/YYYY/MM/YYYY-MM-DD/`.
5. Also stores the Sunday backup under `weekly/YYYY/MM/YYYY-MM-DD/`.
6. Downloads the uploaded daily object again, verifies its SHA-256 checksum, decrypts it, and runs `pg_restore --list`.

GitHub Actions is used only to run the backup job. The database dump is not committed to this public repository and is not stored as a GitHub Actions artifact.

The workflow remains non-destructive until the archive path is proven. A future raw-snapshot archive/cleanup path must follow:

`export -> upload -> verify -> record success -> delete`

If B2 upload or verification fails, the PostgreSQL data must remain untouched.

## B2 bucket and key

Current Bobaks archive bucket:

`bobaks-ranking-archive-ryan01`

The bucket is private. The B2 application key is restricted to this bucket with Read and Write access. "Allow list all bucket names" is not required because Bobaks operates on a known bucket and known object keys.

Do not place the B2 Application Key or any database credentials in source control.

## Required GitHub Actions secrets

Add these repository secrets before activating the scheduled archive:

- `SUPABASE_DB_PASSWORD`
- `BOBAKS_B2_BUCKET`
- `BOBAKS_B2_ACCESS_KEY_ID`
- `BOBAKS_B2_SECRET_ACCESS_KEY`
- `BOBAKS_B2_REGION`
- `BACKUP_ENCRYPTION_KEY`

Set `BOBAKS_B2_BUCKET` to:

`bobaks-ranking-archive-ryan01`

Backblaze's S3-compatible endpoint is derived by the workflow from `BOBAKS_B2_REGION` using the form `https://s3.<region>.backblazeb2.com`. This keeps the region as the single source of truth and avoids endpoint-entry mismatches. The workflow also performs a network connectivity check before uploading.

The backup workflow connects to the Supabase Shared Pooler in Session mode using the exact host and project-specific user from the Supabase Connect dialog. The database password is supplied separately through `SUPABASE_DB_PASSWORD` via PostgreSQL's `PGPASSWORD` environment variable, rather than embedding the password in a connection URI. This avoids URI password-encoding errors while keeping the password out of source control.

The repository currently targets `aws-0-ap-southeast-1.pooler.supabase.com:5432` for the Bobaks project. If Supabase changes the project's pooler host, update the workflow from the Connect dialog before the next backup run.

Generate the separate backup-encryption key locally with:

```bash
openssl rand -base64 32
```

Keep this encryption key separate from the B2 application key.

## Object Lock

Object Lock was enabled when the Bobaks bucket was created. **Object Lock enabled on a bucket does not by itself make uploaded files immutable.** A default bucket retention period or an explicit per-file retention setting must also be configured.

Bobaks does not yet configure a default retention period on this bucket. This avoids accidentally applying a fixed retention policy to every object before the archive lifecycle is finalized.

Until retention is configured, the primary archive safety controls are encryption, private access, least-privilege credentials, checksum verification, and restore testing.

## Archive lifecycle

The `daily/` prefix is for short-term operational recovery.

The `weekly/` prefix is intended for long-term archive copies. Do not enable an expiration policy that can remove long-term weekly archives before an explicit retention decision is made.

## Restore procedure

The repository includes `scripts/restore-backup.sh`.

Use it only with a disposable or dedicated recovery database:

```bash
export BOBAKS_B2_ENDPOINT='https://s3.<region>.backblazeb2.com'
export BOBAKS_B2_BUCKET='bobaks-ranking-archive-ryan01'
export BOBAKS_B2_ACCESS_KEY_ID='...'
export BOBAKS_B2_SECRET_ACCESS_KEY='...'
export BOBAKS_B2_REGION='<region>'
export BACKUP_ENCRYPTION_KEY='...'
export RESTORE_DB_URL='postgresql://...'

./scripts/restore-backup.sh weekly/YYYY/MM/YYYY-MM-DD/bobaks-public-<timestamp>.dump.enc
```

The script refuses to restore into the current Bobaks production Supabase project.

For a repeatable GitHub-based drill, the repository also includes `.github/workflows/restore-drill.yml`. Configure the GitHub Environment named `restore-test` with a `RESTORE_DB_URL` secret pointing to a disposable recovery database, then manually run the workflow and provide a weekly B2 object key.

The restore is data-only. The intended recovery sequence is:

`fresh Supabase project -> apply Bobaks migrations -> restore the public-schema data -> run production integrity audits`

## Verification requirement

A backup is not considered fully validated until the workflow successfully:

1. Creates the encrypted database dump.
2. Uploads the object to B2.
3. Confirms the object exists.
4. Downloads the same object.
5. Confirms the SHA-256 checksum matches.
6. Successfully decrypts the dump.
7. Confirms the dump is structurally readable with `pg_restore --list`.

A separate restore drill must later restore a real weekly archive into an isolated recovery database.

Do not use the production database as the restore-test target.

## Why Backblaze B2

B2 provides an S3-compatible API, bucket-scoped application keys, private buckets, and Object Lock support. Bobaks uses those capabilities for an independent archive rather than making B2 a dependency of the live ranking API.

The goal is to keep an encrypted copy outside the production Postgres database and regularly prove that the copy can be read and restored.

## Supabase Pro later

When Bobaks moves to Supabase Pro, managed database backups can add another recovery layer. The independent B2 archive should remain because it serves a different purpose: long-term independent retention rather than only short recovery-window restoration.
