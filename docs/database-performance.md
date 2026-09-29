# Phase 4 Part 6.1: Database Performance Baseline & Index Audit

This document records the production database baseline used for the Phase 4 Part 6.1 index audit. The goal is to improve database efficiency without changing Bobaks ranking behavior or adding indexes without workload evidence.

## Production baseline

Captured from the Bobaks Ranking Supabase production database on 2026-09-29.

| Metric | Observed |
| --- | ---: |
| PostgreSQL | 17.6.1 |
| Database size | 27 MB |
| GameSnapshot rows | 63,856 |
| GameSnapshot total size | 14 MB |
| Game rows | 229 |
| DailyGameStat rows | 919 |
| DataCollectionLog rows | 565 |
| Ranking rows | 400 |
| GamePeak rows | 229 |
| Table cache hit rate | 100.0000% |
| Index cache hit rate | 99.9914% |

Table index-use percentages at capture time were 96.82% for GameSnapshot, 84.02% for DailyGameStat, 93.27% for DataCollectionLog, 96.17% for Ranking, 99.36% for Game, and 99.97% for GamePeak.

Supabase's production performance advisor returned no performance lints during the audit.

## Hot-query baseline

pg_stat_statements showed these relevant workload patterns:

| Query pattern | Calls | Mean | Max |
| --- | ---: | ---: | ---: |
| refresh_rankings() | 366 | 272.58 ms | 1,203.98 ms |
| GameSnapshot insert | 242 | 45.92 ms | 292.48 ms |
| get_rankings_audit() | 25 | 336.02 ms | 650.11 ms |
| select public.get_rankings_audit() | 20 | 234.51 ms | 425.24 ms |
| assert_rankings_integrity() | 11 | 99.74 ms | 159.50 ms |

Direct execution-plan checks captured during the audit measured get_historical_recovery_audit(31) at about 199 ms and get_rankings_audit() at about 415 ms on the then-current dataset. A separate audit-validation query recorded in pg_stat_statements reached about 4.32 seconds, so audit SQL remains a later optimization target when Part 6.2 begins.

## Index audit

### Removed

Ranking_period_rank_idx is an exact duplicate of Ranking_period_rank_unique_idx:

- same table
- same key columns: (period, rank)
- same B-tree ordering
- the unique index also enforces the existing uniqueness invariant
- duplicate size at capture: 48 kB
- the duplicate had no unique constraint or integrity role of its own

The new hardening SQL removes only this redundant index.

### Kept

The other indexes were not removed because the live workload gives them a distinct purpose:

- Ranking_gameId_idx supports lookups by gameId, which is not covered by the leading column of (period, gameId).
- GameSnapshot_gameId_timestamp_idx supports per-game history and latest-snapshot access.
- GameSnapshot_timestamp_id_idx supports time-ordered retention cleanup.
- GameSnapshot_timestamp_gameId_idx is retained because it has observed usage and a distinct time-first key order.
- GameSnapshot_collectionRunId_idx supports collection-run joins and cleanup/recovery paths.
- DataCollectionLog_startedAt_id_idx supports time-window ordering and retention.
- DataCollectionLog_rankingRefreshStatus_startedAt_idx supports ranking-refresh failure/pending checks.
- unique and primary-key indexes are retained because they enforce or support data integrity.

No additional index was added during 6.1 because the current workload and Supabase performance advisor did not provide enough evidence that another index would improve the production workload.

## Repeatable baseline

database/database-performance-baseline.sql contains the read-only queries used for future comparisons. It captures:

- database and table size
- table scan mix and maintenance counters
- index definitions and usage
- exact duplicate indexes
- cache hit rates
- top Bobaks-related statements from pg_stat_statements

This gives Part 6.2 a fixed before-state for measuring query changes.

## Scope of 6.1

Part 6.1 changes only index redundancy and baseline tooling. Ranking formulas, coverage rules, collection behavior, retention policy, and public API behavior are unchanged.

The next database task can use this baseline to optimize the expensive audit and ranking queries with before/after execution-plan evidence.

## References

The audit approach follows Supabase's current guidance to inspect query plans, index usage, cache hit rates, pg_stat_statements, and the Index Advisor rather than adding indexes indiscriminately.


## Phase 4 Part 6.2: Query Optimization

Production query optimization was completed on 2026-09-29 using the 6.1 baseline above and real PostgreSQL execution plans.

### Before and after

| Workload | Before | After |
| --- | ---: | ---: |
| refresh_rankings() mean from pg_stat_statements | 272.58 ms | 105.49 ms |
| get_rankings_audit() direct EXPLAIN ANALYZE | 414.87 ms | 133.80 ms |
| get_historical_recovery_audit(31) direct EXPLAIN ANALYZE | 199.02 ms | 42.90 ms |
| Live latest-snapshot query | 110.56 ms | 3.62 ms |

The measured reductions were approximately 61% for the end-to-end ranking refresh, 68% for the ranking audit, 78% for the historical recovery audit, and 97% for the standalone live latest-snapshot query.

### Execution-plan changes

The live ranking path no longer sorts the entire GameSnapshot table to find the newest row per game. It now performs an indexed per-game latest lookup using the existing GameSnapshot_gameId_timestamp_idx path and keeps the existing collection-run qualification and 15-minute freshness rule.

Weekly and monthly ranking calculations share one current-period aggregation in the refresh and ranking-integrity SQL. The lower bound includes a UTC week that crosses a month boundary, so the existing calendar-period behavior is preserved.

The historical recovery audit no longer joins DailyGameStat back to GameSnapshot just to count observed summary days. Raw snapshot min/max timestamps are derived from the existing source aggregation, while summary-day coverage is read directly from DailyGameStat.

No new index was added in 4.6.2. The optimization uses indexes already justified by the 6.1 workload audit.

### Correctness verification

At a single fixed production timestamp, the old and optimized standalone ranking queries produced:

| Ranking workload | Old rows | New rows | Differences |
| --- | ---: | ---: | ---: |
| Live | 121 | 121 | 0 |
| Weekly | 120 | 120 | 0 |
| Monthly | 124 | 124 | 0 |

After the optimized functions were deployed, the production audit returned `auditStatus: passed`, historical recovery reported `recoverableDailyRows: 0`, and the persisted Ranking table contained 100 rows for live, weekly, monthly, and yearly, each with ranks 1 through 100 and 100 distinct games.

### Production migration history

The optimization was recorded in Supabase migration `20260929090843_optimize_ranking_and_audit_queries`. A follow-up correction migration `20260929091030_fix_query_optimization_audit_regressions` records the production-safe fixes made immediately after the first deployment.

The repository contains the corresponding migration files under `supabase/migrations/`.

### Scope

Phase 4 Part 6.2 changed query execution strategy only. Ranking formulas, 50% coverage rules, game-activity rules, retention windows, and public API contracts remain unchanged.
