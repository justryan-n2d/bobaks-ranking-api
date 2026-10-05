import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Supabase security hardening migration pins the ranking audit search path", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261005141312_security_hardening_core_tables_and_audit_search_path.sql"
    ),
    "utf8"
  );

  assert.match(
    sql,
    /ALTER FUNCTION public\.get_rankings_audit\(\)[\s\S]*SET search_path = public, pg_temp;/
  );
});

test("Supabase security hardening blocks direct anon/authenticated table access", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261005141312_security_hardening_core_tables_and_audit_search_path.sql"
    ),
    "utf8"
  );

  for (const table of [
    "Game",
    "GameSnapshot",
    "GamePeak",
    "DailyGameStat",
    "DataCollectionLog",
    "Ranking"
  ]) {
    assert.ok(sql.includes(
      'REVOKE ALL ON TABLE public."' + table + '" FROM anon, authenticated;'
    ));
    assert.ok(sql.includes(
      'CREATE POLICY deny_direct_api_access\n  ON public."' + table + '"'
    ));
    assert.ok(sql.includes(
      "TO anon, authenticated\n  USING (false)\n  WITH CHECK (false);"
    ));
  }
});
