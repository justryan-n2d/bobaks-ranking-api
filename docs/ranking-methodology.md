# How Bobaks Rankings Work

Bobaks Ranking publishes rankings from data collected from Roblox public experience data.

## Collection

The collector runs every 10 minutes.

Each collection run gets a unique collection run ID. New snapshots are linked to that run, and the run is finalized before rankings are refreshed.

Successful and partial collection runs count as coverage opportunities. Failed runs do not.

## Ranking rules

### Live

Live ranking uses the latest qualifying player-count snapshot for each active game.

A snapshot must be no more than 15 minutes old at ranking calculation time.

Score: latest player count.

### Weekly

Weekly means the current UTC calendar week, Monday through Sunday.

Score: arithmetic mean of the game's qualifying player-count snapshots in that week.

A game must have at least 12 samples and at least 50% coverage.

Coverage:

`game snapshots / successful or partial collection runs`

The denominator uses collection-run start time, so a run belongs to the period where it started.

### Monthly

Monthly means the current UTC calendar month.

Score: arithmetic mean of the game's qualifying player-count snapshots in that month.

A game must have at least 12 samples and at least 50% coverage.

Coverage uses the same formula as Weekly.

### Yearly

Yearly uses exactly 365 UTC calendar dates.

The current UTC day uses raw snapshots. The previous 364 days use DailyGameStat summaries.

Score is a weighted average:

`sum(playerSum) / sum(totalSamples)`

## Ranking output

Bobaks publishes the top 100 games for every ranking period.

Higher scores rank first. When two games have the same score, the lower game ID is ordered first so the result is deterministic.

Only active games are eligible.

## Data qualification

Future snapshots are excluded.

Snapshots linked to failed collection runs are excluded.

Older unlinked snapshots are retained for backward compatibility with data collected before collection-run linkage was added.

## Game activity

A game is not immediately deactivated when it disappears from discovery.

After 24 hours without observation, Bobaks starts explicit verification.

A game is deactivated after 12 consecutive verification misses, about 2 hours at the normal 10-minute cycle.

A later successful discovery can reactivate it.

## Integrity and auditability

Ranking refreshes use a transaction and an advisory lock to prevent concurrent refreshes from interleaving.

Before a refresh commits, Bobaks checks row counts, rank continuity, duplicate games, score validity, ordering, active-game membership, Live freshness, and period-specific Weekly, Monthly, and Yearly rules.

If the integrity check fails, the transaction raises an error and the invalid ranking set is not committed.

The Live refresh also fails closed when the newly calculated set falls below 50% of the expected top-100 active-game capacity, so a source outage or severe partial result does not wipe the persisted Live ranking.

Public endpoints:

- `GET /api/rankings/methodology` returns the canonical rules used by the API.
- `GET /api/rankings/audit` runs the server-side integrity audit and returns current audit metadata.

## Limitations

Bobaks represents collected snapshots, not every moment of gameplay.

Roblox rate limits, outages, or discovery gaps can reduce the amount of data collected.

Coverage measures Bobaks collection opportunities and collected samples, not total Roblox availability.

Ranking values can change when new collection cycles arrive.
