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

test("legal acceptance function is execution-restricted", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261007120423_harden_accept_current_legal_execution.sql"
    ),
    "utf8"
  );
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.accept_current_legal\(\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.accept_current_legal\(\) TO authenticated, service_role;/);
  assert.match(sql, /ALTER FUNCTION public\.accept_current_legal\(\) SET search_path = '';/);
});

test("future snapshots require collection-run provenance", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261007123000_enforce_snapshot_collection_run_provenance.sql"
    ),
    "utf8"
  );
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS data_collection_log_collection_run_id_key/);
  assert.match(sql, /ALTER TABLE public\."GameSnapshot"/);
  assert.match(sql, /FOREIGN KEY \("collectionRunId"\)/);
  assert.match(sql, /REFERENCES public\."DataCollectionLog" \("collectionRunId"\)/);
  assert.match(sql, /NOT VALID/);
});
