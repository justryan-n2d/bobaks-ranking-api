-- Phase 4 Part 6.1: read-only database performance baseline.
--
-- Run this script from the Supabase SQL editor or a privileged SQL client.
-- It only reads PostgreSQL statistics and catalog metadata.

-- Database size and connection ceiling.
SELECT
  current_database() AS database_name,
  current_setting('server_version') AS postgres_version,
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  current_setting('max_connections') AS max_connections;

-- Table growth, scan mix, and maintenance activity.
SELECT
  relname AS table_name,
  n_live_tup,
  n_dead_tup,
  round(
    100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0),
    2
  ) AS index_use_pct,
  autovacuum_count,
  autoanalyze_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

-- Table and index storage footprint.
SELECT
  c.relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- Index definitions and observed usage.
SELECT
  s.relname AS table_name,
  s.indexrelname AS index_name,
  s.idx_scan,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  pg_get_indexdef(s.indexrelid) AS index_definition
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
ORDER BY s.relname, s.indexrelname;

-- Exact duplicate-index detection.
WITH idx AS (
  SELECT
    i.indrelid,
    i.indexrelid,
    i.indkey::text AS indkey,
    i.indclass::text AS indclass,
    i.indcollation::text AS indcollation,
    i.indpred IS NULL AS is_unconditional,
    i.indisunique
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
)
SELECT
  a.indexrelid::regclass AS duplicate_index,
  b.indexrelid::regclass AS equivalent_unique_index
FROM idx a
JOIN idx b
  ON a.indrelid = b.indrelid
 AND a.indkey = b.indkey
 AND a.indclass = b.indclass
 AND a.indcollation = b.indcollation
 AND a.is_unconditional = b.is_unconditional
 AND a.indexrelid <> b.indexrelid
WHERE a.indisunique = false
  AND b.indisunique = true
ORDER BY a.indexrelid::regclass::text;

-- Cache hit rates.
SELECT
  round(
    100.0 * sum(heap_blks_hit)::numeric
      / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0),
    4
  ) AS table_cache_hit_pct,
  round(
    100.0 * sum(idx_blks_hit)::numeric
      / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0),
    4
  ) AS index_cache_hit_pct
FROM pg_statio_user_tables;

-- Top database statements touching Bobaks data tables.
SELECT
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(max_exec_time::numeric, 2) AS max_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  rows,
  LEFT(query, 500) AS query
FROM pg_stat_statements
WHERE query ILIKE '%GameSnapshot%'
   OR query ILIKE '%DailyGameStat%'
   OR query ILIKE '%DataCollectionLog%'
   OR query ILIKE '%Ranking%'
ORDER BY total_exec_time DESC
LIMIT 20;
