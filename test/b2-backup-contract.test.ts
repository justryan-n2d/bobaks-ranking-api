import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/backup-disaster-recovery.yml", "utf8");
const restore = readFileSync("scripts/restore-backup.sh", "utf8");
const docs = readFileSync("docs/backup-disaster-recovery.md", "utf8");

test("B2 archive workflow uses bucket-scoped B2 credentials and region", () => {
  for (const name of [
    "BOBAKS_B2_ENDPOINT",
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
  assert.match(workflow, /printf 'y\\n' \| sudo \/usr\/share\/postgresql-common\/pgdg\/apt\.postgresql\.org\.sh/);
  assert.match(workflow, /Normalize B2 endpoint/);
  assert.match(workflow, /https:\/\//);
  assert.match(workflow, /B2_ENDPOINT=/);
  assert.match(workflow, /psql .*select current_user, current_database/);
  assert.doesNotMatch(workflow, /--dbname="\$\{SUPABASE_DB_URL\}"/);
});

test("restore script targets B2 and accepts the B2 region", () => {
  assert.match(restore, /BOBAKS_B2_ENDPOINT/);
  assert.match(restore, /BOBAKS_B2_BUCKET/);
  assert.match(restore, /BOBAKS_B2_ACCESS_KEY_ID/);
  assert.match(restore, /BOBAKS_B2_SECRET_ACCESS_KEY/);
  assert.match(restore, /BOBAKS_B2_REGION/);
  assert.doesNotMatch(restore, /R2_/);
});

test("backup documentation describes B2 rather than the retired R2 path", () => {
  assert.match(docs, /Backblaze B2/i);
  assert.match(docs, /BOBAKS_B2_ENDPOINT/);
  assert.doesNotMatch(docs, /BOBAKS_R2_/);
});
