import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("ranking refresh uses indexed per-game latest lookups and one current-month aggregate", () => {
  const sql = readFileSync(
    join(root, "database", "cloudflare-collector-functions.sql"),
    "utf8"
  );

  const refreshSql = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.refresh_rankings()")
  );

  assert.match(refreshSql, /JOIN LATERAL\s*\(\s*SELECT[\s\S]*?FROM public\."GameSnapshot"/);
  assert.match(refreshSql, /current_period_samples AS MATERIALIZED \(/);
  assert.match(refreshSql, /weekly_score/);
  assert.match(refreshSql, /monthly_score/);

  const snapshotSources = (refreshSql.match(/FROM public\."GameSnapshot" s/g) ?? []).length;
  assert.ok(
    snapshotSources <= 3,
    "refresh_rankings should use the live lookup, one current-period aggregate, and the yearly current-day scan"
  );
});

test("ranking audit reuses a combined current-month sample aggregation and indexed latest lookup", () => {
  const sql = readFileSync(
    join(root, "database", "ranking-audit.sql"),
    "utf8"
  );

  assert.match(sql, /JOIN LATERAL\s*\(\s*SELECT[\s\S]*?FROM public\."GameSnapshot"/);
  assert.match(sql, /current_month_samples AS MATERIALIZED \(/);
  assert.match(sql, /weekly_score/);
  assert.match(sql, /monthly_score/);
});

test("historical recovery audit derives summary-day coverage without joining summaries back to snapshots", () => {
  const sql = readFileSync(
    join(root, "database", "historical-recovery-audit.sql"),
    "utf8"
  );

  assert.match(sql, /SELECT COUNT\(DISTINCT day\)/);
  assert.doesNotMatch(
    sql,
    /COUNT\(DISTINCT \(d\."date" AT TIME ZONE 'UTC'\)::date\)[\s\S]*LEFT JOIN public\."GameSnapshot"/
  );
});
