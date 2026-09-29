# Bobaks Backup and Disaster Recovery

## Purpose

Bobaks keeps long-term ranking history in Supabase. The live database has retention controls, but long-term durability also needs an independent export that can survive a database or project failure.

Supabase recommends that Free Plan projects regularly export their data and keep off-site backups. Supabase database backups on paid plans are separate from the long-term archive described here.

## Backup architecture

The scheduled GitHub Actions workflow:

1. Creates a logical PostgreSQL custom-format dump of the `public` schema.
2. Encrypts the dump with AES-256-CBC using PBKDF2.
3. Uploads the encrypted dump and a non-secret manifest to Cloudflare R2.
4. Keeps daily backups under `daily/YYYY/MM/YYYY-MM-DD/`.
5. Also stores the Sunday backup under `weekly/YYYY/MM/YYYY-MM-DD/`.
6. Downloads the uploaded object again, verifies its SHA-256 checksum, decrypts it, and runs `pg_restore --list`.

GitHub Actions is used only to run the backup job. The database dump itself is not committed to this public repository and is not stored as a GitHub artifact.

## Required GitHub Actions secrets

Configure these repository secrets before enabling the scheduled backup:

- `SUPABASE_DB_URL`
- `BOBAKS_R2_ENDPOINT`
- `BOBAKS_R2_BUCKET`
- `BOBAKS_R2_ACCESS_KEY_ID`
- `BOBAKS_R2_SECRET_ACCESS_KEY`
- `BACKUP_ENCRYPTION_KEY`

Generate the encryption key locally with:

```bash
openssl rand -base64 32
```

The R2 endpoint has the form:

```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Use an R2 API token limited to the backup bucket with Object Read & Write access.

## Create the R2 bucket

Create a private R2 bucket for Bobaks backups. Do not enable public bucket access.

Cloudflare R2 supports the S3-compatible API, which is what the GitHub workflow uses.

After the bucket exists, set these GitHub secrets:

```text
BOBAKS_R2_ENDPOINT
BOBAKS_R2_BUCKET
BOBAKS_R2_ACCESS_KEY_ID
BOBAKS_R2_SECRET_ACCESS_KEY
```

## Long-term retention

The `daily/` prefix is intended for short-term operational recovery and should normally have a lifecycle rule such as 90 days.

The `weekly/` prefix is the long-term archive. Configure an R2 Bucket Lock rule for this prefix with indefinite retention, or use another retention policy that matches the desired archive period.

Do not configure a lifecycle expiration rule that can delete the weekly archive.

## Restore procedure

The repository includes `scripts/restore-backup.sh`.

Use it only with a disposable or dedicated recovery database:

```bash
export R2_ENDPOINT='https://<ACCOUNT_ID>.r2.cloudflarestorage.com'
export R2_BUCKET='bobaks-backups'
export R2_ACCESS_KEY_ID='...'
export R2_SECRET_ACCESS_KEY='...'
export BACKUP_ENCRYPTION_KEY='...'
export RESTORE_DB_URL='postgresql://...'

./scripts/restore-backup.sh   weekly/2026/09/2026-09-27/bobaks-public-20260927T013000Z.dump.enc
```

The script refuses to restore into the current Bobaks production Supabase project.

The restore is data-only. The intended recovery sequence is:

`fresh Supabase project -> apply Bobaks migrations -> restore the public-schema data -> run production integrity audits`

## Recovery test

A backup is not considered fully validated until a real restore drill succeeds.

The scheduled backup workflow already performs a structural validation by decrypting the remote object and running `pg_restore --list`.

A future restore drill should restore a recent weekly archive into an isolated Supabase project, then verify:

- all expected tables exist
- Game, GameSnapshot, DailyGameStat, GamePeak, Ranking, and DataCollectionLog contain expected data
- ranking integrity audit passes
- historical API requests work against the recovered database

Do not use the production database as the restore-test target.

## Why R2

Cloudflare documents R2 as an S3-compatible object store and states that R2 is designed for 11 nines of annual durability. R2 also supports bucket-level retention controls that can keep objects indefinitely.

The goal here is not to claim that any cloud provider makes data loss impossible. The goal is to keep an independent, encrypted copy outside the production Postgres database and to regularly prove that the copy can be read and restored.

## Supabase Pro later

When Bobaks moves to Supabase Pro, its daily managed database backups provide an additional recovery layer. The off-site R2 archive should remain in place because it serves a different purpose: long-term independent retention rather than short recovery-window restoration.
