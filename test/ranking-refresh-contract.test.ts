import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("ranking refresh SQL keeps the reliability guards", () => {
  const sql = readFileSync(
    join(process.cwd(), "database", "cloudflare-collector-functions.sql"),
    "utf8"
  );

  assert.match(sql, /pg_advisory_xact_lock\(\s*\n\s*hashtextextended\('bobaks\.refresh_rankings'/);
  assert.match(sql, /SELECT count\(\*\)\s+INTO live_candidate_rows/);
  assert.match(sql, /live_minimum_rows := GREATEST\(/);
  assert.match(sql, /Ranking refresh aborted: live candidate has/);
  assert.match(sql, /PERFORM public\.assert_rankings_integrity\(\)/);
});
