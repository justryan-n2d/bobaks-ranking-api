import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("database performance hardening removes only the proven duplicate ranking index", () => {
  const path = join(root, "database", "database-performance-hardening.sql");
  assert.equal(existsSync(path), true, "performance hardening SQL must exist");

  const sql = readFileSync(path, "utf8");

  assert.match(
    sql,
    /DROP INDEX IF EXISTS public\."Ranking_period_rank_idx";/
  );
  assert.doesNotMatch(sql, /DROP INDEX IF EXISTS public\."Ranking_period_gameId_unique_idx"/);
  assert.doesNotMatch(sql, /DROP INDEX IF EXISTS public\."GameSnapshot_/);
  assert.match(
    sql,
    /Ranking_period_rank_unique_idx/
  );
});

test("database performance baseline SQL is read-only and covers the live audit surfaces", () => {
  const path = join(root, "database", "database-performance-baseline.sql");
  assert.equal(existsSync(path), true, "performance baseline SQL must exist");

  const sql = readFileSync(path, "utf8");

  assert.match(sql, /pg_stat_statements/);
  assert.match(sql, /pg_stat_user_tables/);
  assert.match(sql, /pg_stat_user_indexes/);
  assert.match(sql, /pg_statio_user_tables/);
  assert.match(sql, /pg_indexes/);
  assert.doesNotMatch(sql, /\\b(?:CREATE|ALTER|DROP|TRUNCATE)\\s+(?:INDEX|TABLE|FUNCTION|VIEW)/i);
});

test("database performance documentation records the approved index decision", () => {
  const path = join(root, "docs", "database-performance.md");
  assert.equal(existsSync(path), true, "database performance documentation must exist");

  const doc = readFileSync(path, "utf8");

  assert.match(doc, /GameSnapshot/);
  assert.match(doc, /Ranking_period_rank_idx/);
  assert.match(doc, /Ranking_period_rank_unique_idx/);
  assert.match(doc, /27 MB/);
  assert.match(doc, /63,856/);
  assert.match(doc, /99\.9914%/);
});
