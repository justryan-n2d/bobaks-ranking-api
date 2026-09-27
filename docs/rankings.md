# How Bobaks Rankings Work

Bobaks Ranking publishes the top 100 collected Roblox experiences for four ranking periods: Live, Weekly, Monthly, and Yearly.

## Shared rules

- Rankings use data collected by Bobaks. They do not represent every moment of Roblox activity.
- Only active games can appear in rankings.
- A ranking refresh uses the latest qualifying data available at calculation time.
- Scores are ordered from highest to lowest.
- Equal scores are tied deterministically by ascending internal game ID.
- The published ranking is limited to the top 100.
- Collection runs with status `success` or `partial` count toward Weekly and Monthly coverage.
- Failed collection runs do not count toward coverage and their linked snapshots are excluded.
- Weekly and Monthly linked snapshots use the collection run's `startedAt` for period membership. Legacy snapshots without a collection run ID use the snapshot timestamp.

## Live

Live uses the most recent qualifying snapshot for each active game.

A Live row is eligible only when that snapshot is no more than 15 minutes old at ranking calculation time.

Score:

`latest player count`

## Weekly

Weekly covers the current UTC calendar week, Monday through Sunday.

Score:

`average player count across qualifying snapshots in the week`

Eligibility:

- At least 12 qualifying samples.
- At least 50% coverage.

Coverage:

`game samples / successful or partial collection runs in the week`

Coverage is capped at 100% for eligibility purposes.

## Monthly

Monthly covers the current UTC calendar month.

Score:

`average player count across qualifying snapshots in the month`

Eligibility:

- At least 12 qualifying samples.
- At least 50% coverage.

Coverage:

`game samples / successful or partial collection runs in the month`

Coverage is capped at 100% for eligibility purposes.

## Yearly

Yearly is a rolling 365 UTC calendar-date window.

It uses:

- The current UTC day from raw GameSnapshot data.
- The prior 364 complete UTC days from DailyGameStat summaries.

The score is a weighted average of the underlying player-count samples:

`sum of player counts / total sample count`

No separate 12-sample or 50% coverage threshold is applied to Yearly.

## Game activity

Bobaks does not immediately deactivate a game when discovery misses it.

An active game that has not been observed for 24 hours enters explicit Roblox verification.

A game is deactivated after 12 consecutive verification misses, which is about two hours at the normal 10-minute collection cadence.

A later successful discovery reactivates the game.

## Transparency and auditability

Each ranking response exposes its calculation timestamp and next expected collection time.

The public rules endpoint is:

`GET /api/rankings/rules`

The ranking database also enforces integrity checks for row limits, rank ranges, unique games, score validity, ordering, Live freshness, period eligibility, and score recalculation consistency.

Methodology version: `2026-09-28`
