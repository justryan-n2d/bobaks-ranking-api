import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/backup-disaster-recovery.yml", "utf8");
const restore = readFileSync("scripts/restore-backup.sh", "utf8");
const restoreWorkflow = readFileSync(".github/workflows/restore-drill.yml", "utf8");
const docs = readFileSync("docs/backup-disaster-recovery.md", "utf8");

test("B2 archive workflow uses bucket-scoped B2 credentials and region", () => {
  for (const name of [
    "BOBAKS_B2_BUCKET",
    "BOBAKS_B2_ACCESS_KEY_ID",
    "BOBAKS_B2_SECRET_ACCESS_KEY",
    "BOBAKS_B2_REGION",
  ]) {
    assert.match(workflow, new RegExp(name));
  }

  assert.ok(workflow.includes("AWS_DEFAULT_REGION: \${{ secrets.BOBAKS_B2_REGION }}"));
  assert.doesNotMatch(workflow, /BOBAKS_R2_/);
});

test("backup workflow uses password-based Postgres environment variables", () => {
  assert.match(workflow, /SUPABASE_DB_PASSWORD/);
  assert.match(workflow, /PGPASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/);
  assert.match(workflow, /PGHOST:/);
  assert.match(workflow, /PGUSER:/);
  assert.match(workflow, /PGPORT:/);
  assert.match(workflow, /PGDATABASE:/);
  assert.match(workflow, /PGSSLMODE: require/);
  assert.match(workflow, /Install PostgreSQL 17 client/);
  assert.match(workflow, /postgresql-client-17/);
  assert.match(workflow, /\/usr\/lib\/postgresql\/17\/bin/);
  assert.ok(workflow.includes("printf 'PATH=/usr/lib/postgresql/17/bin:%s\\n' \"${PATH}\" >> \"${GITHUB_ENV}\""));
  assert.match(workflow, /name: Verify PostgreSQL 17 client tools/);
  assert.ok(workflow.includes('pg_dump_version="$("/usr/lib/postgresql/17/bin/pg_dump" --version)"'));
  assert.ok(workflow.includes('pg_restore_version="$("/usr/lib/postgresql/17/bin/pg_restore" --version)"'));
  assert.ok(workflow.includes('psql_version="$("/usr/lib/postgresql/17/bin/psql" --version)"'));
  assert.match(workflow, /printf 'y\\n' \| sudo \/usr\/share\/postgresql-common\/pgdg\/apt\.postgresql\.org\.sh/);
  assert.match(workflow, /Build B2 endpoint from region/);
  assert.match(workflow, /Verify B2 endpoint connectivity/);
  assert.match(workflow, /https:\/\/s3\.\$\{region\}\.backblazeb2\.com/);
  assert.match(workflow, /B2_ENDPOINT=/);
  assert.match(workflow, /--endpoint-url "\$\{B2_ENDPOINT\}"/);
  assert.doesNotMatch(workflow, /BOBAKS_B2_ENDPOINT/);
  assert.match(workflow, /BOBAKS_B2_REGION/);
  assert.match(workflow, /psql .*select current_user, current_database/);
  assert.doesNotMatch(workflow, /--dbname="\$\{SUPABASE_DB_URL\}"/);
});

test("restore workflow uses repository Actions secrets without a GitHub environment", () => {
  assert.doesNotMatch(restoreWorkflow, /^\s+environment:\s+restore-test\s*$/m);
  assert.ok(restoreWorkflow.includes("      BOBAKS_B2_REGION: ${{ secrets.BOBAKS_B2_REGION }}"), "missing repository secret mapping for BOBAKS_B2_REGION");
  assert.ok(restoreWorkflow.includes("      BOBAKS_B2_BUCKET: ${{ secrets.BOBAKS_B2_BUCKET }}"), "missing repository secret mapping for BOBAKS_B2_BUCKET");
  assert.ok(restoreWorkflow.includes("      BOBAKS_B2_ACCESS_KEY_ID: ${{ secrets.BOBAKS_B2_ACCESS_KEY_ID }}"), "missing repository secret mapping for BOBAKS_B2_ACCESS_KEY_ID");
  assert.ok(restoreWorkflow.includes("      BOBAKS_B2_SECRET_ACCESS_KEY: ${{ secrets.BOBAKS_B2_SECRET_ACCESS_KEY }}"), "missing repository secret mapping for BOBAKS_B2_SECRET_ACCESS_KEY");
  assert.ok(restoreWorkflow.includes("      BACKUP_ENCRYPTION_KEY: ${{ secrets.BACKUP_ENCRYPTION_KEY }}"), "missing repository secret mapping for BACKUP_ENCRYPTION_KEY");
  assert.ok(restoreWorkflow.includes("      RESTORE_DB_URL: ${{ secrets.RESTORE_DB_URL }}"), "missing repository secret mapping for RESTORE_DB_URL");
  assert.doesNotMatch(restoreWorkflow, /BOBAKS_B2_ENDPOINT/);
  assert.match(restoreWorkflow, /Install PostgreSQL 17 client/);
  assert.match(restoreWorkflow, /postgresql-client-17/);
  assert.match(restoreWorkflow, /\/usr\/lib\/postgresql\/17\/bin\/pg_restore/);
  assert.match(restoreWorkflow, /Verify PostgreSQL 17 client tools/);
  assert.doesNotMatch(restoreWorkflow, /restore-test/);
});

test("restore documentation uses repository Actions secrets", () => {
  assert.match(docs, /repository secrets/i);
  assert.doesNotMatch(docs, /GitHub Environment named `restore-test`/);
});

test("restore script targets B2 and accepts the B2 region", () => {
  assert.match(restore, /BOBAKS_B2_REGION/);
  assert.match(restore, /BOBAKS_B2_ENDPOINT="https:\/\/s3\.\$\{BOBAKS_B2_REGION\}\.backblazeb2\.com"/);
  assert.doesNotMatch(restore, /BOBAKS_B2_ENDPOINT:\?/);
  assert.match(restore, /Temporarily removing public foreign-key constraints/);
  assert.match(restore, /Preparing public foreign-key definitions/);
  assert.match(restore, /pg_constraint/);
  assert.match(restore, /Creating isolated auth placeholders/);
  assert.match(restore, /bobaks_recovery_placeholder/);
  assert.match(restore, /Recreating public foreign-key constraints/);
  assert.match(restore, /\bpsql\b/);
  assert.doesNotMatch(restore, /--disable-triggers/);
  assert.match(restore, /BOBAKS_B2_BUCKET/);
  assert.match(restore, /BOBAKS_B2_ACCESS_KEY_ID/);
  assert.match(restore, /BOBAKS_B2_SECRET_ACCESS_KEY/);
  assert.match(restore, /BOBAKS_B2_REGION/);
  assert.doesNotMatch(restore, /R2_/);
});

test("backup documentation describes B2 rather than the retired R2 path", () => {
  assert.match(docs, /Backblaze B2/i);
  assert.match(docs, /BOBAKS_B2_REGION/);
  assert.doesNotMatch(docs, /BOBAKS_B2_ENDPOINT.*secret/i);
  assert.doesNotMatch(docs, /BOBAKS_R2_/);
});
