# Phase 4 Part 5: Operational Observability

Operational observability exposes read-only telemetry for the Bobaks collection and ranking pipeline without adding a paid monitoring service or a new metrics store.

## Endpoint

`GET /api/observability`

Optional query parameter:

- `hours`: integer from 1 to 168. Defaults to 24.

The endpoint reads retained `DataCollectionLog` rows from the requested window and returns:

- collection run counts by status
- completion rate and full-success rate
- games checked, updated, and collection errors
- collection duration count, average, p50, p95, and maximum
- ranking-refresh success, failure, pending, and unknown counts
- ranking-refresh duration count, average, p50, p95, and maximum
- largest observed gap between collection starts
- the latest collection run and its ranking-refresh timing

Only aggregate operational telemetry is returned. The endpoint does not return Supabase credentials, Roblox request payloads, or per-game player-count data.

## Metric definitions

### Run rates

`completionRate` is `(success + partial) / total`.

`fullSuccessRate` is `success / total`.

When there are no runs, both values are `0`.

### Durations

Durations are calculated only when both timestamps parse successfully and the finish timestamp is not earlier than the start timestamp.

Percentiles use the nearest-rank method. For p95, the selected value is the smallest sorted value whose one-based rank is at least 95% of the sample count.

Invalid or incomplete durations are excluded rather than fabricated.

### Schedule

Bobaks' expected collection interval is 600 seconds.

`largestObservedGapSeconds` is the largest interval between adjacent observed collection start times inside the requested window. It is `null` when fewer than two runs have valid start timestamps.

## Operational use

This endpoint is intended to answer questions such as:

- Are collection runs completing?
- Are partial or failed runs becoming common?
- Is collection latency increasing?
- Is ranking refresh latency increasing?
- Are collection starts drifting or developing large gaps?

Phase 4 Part 1 remains the source for health status and alerting. Part 5 adds trend and performance context for investigation.