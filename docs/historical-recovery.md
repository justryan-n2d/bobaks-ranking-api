# Historical Recovery

Phase 3 Part 6 covers recovery from collection failures, missing runs, partial runs, collector outages, and database interruptions.

## Recovery behavior

Bobaks uses GameSnapshot as the detailed source of truth and DailyGameStat as the compact long-term record.

When a daily-summary run is missed or interrupted, the next summary execution calls repair_missing_daily_game_stats(31, 31). It scans the retained raw-snapshot window, rebuilds missing or inconsistent daily rows, and processes repair days in UTC date order.

Collection-run status controls which snapshots are eligible:

- success snapshots are eligible.
- partial snapshots are eligible for the data they actually produced.
- failed snapshots are excluded from daily statistics.

A failed collection day with no qualifying snapshots does not produce a synthetic zero or other fabricated daily statistic. There is no source data to recover.

## Recovery audit

public.get_historical_recovery_audit(31) is a read-only service-role RPC. It reports:

- recoverable missing or inconsistent daily rows
- UTC raw days observed in the retained window
- daily-summary days observed
- raw days without a daily summary
- successful, partial, and failed collector runs
- collection gaps over 20 minutes
- the largest observed collection gap
- oldest and newest retained raw snapshot timestamps

The audit status is passed when there are no recoverable daily-summary gaps. Collection gaps are reported separately because an outage may be real even when the retained historical record is internally consistent.

The public /api/rankings/audit response includes this historical recovery section.

## Failure scenarios

### One failed collection day

Expected behavior:

failed run -> no qualifying snapshot -> no fabricated DailyGameStat

Later recovery cannot reconstruct observations that never existed.

### Several missing collection runs

Expected behavior:

missing/inconsistent summary for a day with raw snapshots -> repair_missing_daily_game_stats() -> rebuilt DailyGameStat

The repair function can process multiple missed days within the retained 31-day raw window.

### Partial collection run

Expected behavior:

partial run -> snapshots that were successfully written remain eligible

The summary uses only the snapshots actually stored for that partial run.

### Collector outage

Expected behavior:

The collection log records failed attempts. The recovery audit exposes long gaps. No historical values are invented for periods with no qualifying snapshots.

### Database interruption during repair

The daily-summary repair path runs inside the PostgreSQL transaction that invokes the RPC. An aborted transaction does not leave a partially committed repair set.

## Tested against production

A transactional synthetic drill has been run against the production database and rolled back after validation. It verified:

1. failed-run snapshots are excluded from daily statistics
2. partial-run snapshots remain included
3. missing daily summaries are rebuilt
4. failed outage days do not create synthetic summaries
5. inconsistent daily summaries are corrected by the repair function

The drill leaves no synthetic rows behind when it succeeds.

## Disaster recovery backup

The independent database backup and restore workflow is documented in backup-disaster-recovery.md.

The actual R2 archive and isolated restore drill remain pending while external backup storage activation is paused.
