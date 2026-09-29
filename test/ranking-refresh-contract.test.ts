import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("ranking refresh keeps integrity guards and records prior ranks", () => {
  const sql = readFileSync(
    join(process.cwd(), "database", "cloudflare-collector-functions.sql"),
    "utf8"
  );

  assert.match(sql, /pg_advisory_xact_lock\(\s*hashtextextended\('bobaks\.refresh_rankings'/);
  assert.match(sql, /CREATE TEMP TABLE old_ranking_snapshot/);
  assert.match(sql, /"previousRank"/);
  assert.match(sql, /SELECT count\(\*\) INTO live_candidate_rows/);
  assert.match(sql, /live_minimum_rows := GREATEST\(/);
  assert.match(sql, /Ranking refresh aborted: live candidate has/);
  assert.match(sql, /PERFORM public\.assert_rankings_integrity\(\)/);
});

test("Phase 5 migration contains game analytics helpers", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260929095146_phase5_gamer_experience.sql"),
    "utf8"
  );

  assert.match(sql, /ADD COLUMN IF NOT EXISTS "previousRank"/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_game_current_stats/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_game_rank_history/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_game_current_stats\(bigint\) TO service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_game_rank_history\(bigint,integer\) TO service_role/);
});

test("API exposes Phase 5 rank movement, rank history, and creator search", () => {
  const api = readFileSync(join(process.cwd(), "src", "api-worker.ts"), "utf8");
  assert.match(api, /previousRank/);
  assert.match(api, /rankChange/);
  assert.match(api, /get_game_current_stats/);
  assert.match(api, /get_game_rank_history/);
  assert.match(api, /rank-history/);
  assert.match(api, /creatorName/);
  assert.match(api, /ilike/);
});
