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
    assert.match(workflow, new RegExp(name.replaceAll("_", "\\_")));
  }

  assert.match(workflow, /AWS_DEFAULT_REGION: \\$\\{\\{ secrets\\.BOBAKS_B2_REGION \\}\\}/);
  assert.doesNotMatch(workflow, /BOBAKS_R2_/);
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
  assert.match(docs, /BOBAKS_B2_BUCKET/);
  assert.doesNotMatch(docs, /BOBAKS_R2_/);
});
