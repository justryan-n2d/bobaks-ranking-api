import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("production alerting workflow follows production health failures and recovery", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "production-alerting.yml"),
    "utf8"
  );

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Production Health Monitor/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.conclusion == 'failure'/
  );
  assert.match(
    workflow,
    /github\.event\.workflow_run\.conclusion == 'success'/
  );
  assert.match(workflow, /actions\/github-script@v8/);
  assert.match(workflow, /issues\.create/);
  assert.match(workflow, /issues\.update/);
});
