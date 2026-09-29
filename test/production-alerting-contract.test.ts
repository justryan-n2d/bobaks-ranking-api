import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("production alerting workflow has incident creation and recovery handling", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "production-alerting.yml"),
    "utf8"
  );

  assert.match(workflow, /cron:\s*"\/\*15 \* \* \* \*"/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /api\/health\/deep/);
  assert.match(workflow, /collector.*\/health|\/health/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /gh issue close/);
  assert.match(workflow, /No active production incident issue/);
});
