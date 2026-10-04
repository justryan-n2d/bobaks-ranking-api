# Collection Reliability

Phase 4 Part 2 hardens the Roblox collection path against transient upstream failures.

## Retry behavior

Roblox HTTP 429 responses are retried up to three attempts.

When Roblox provides a Retry-After header, Bobaks uses that delay, capped at 15 seconds. When the header is absent or invalid, Bobaks falls back to the existing bounded retry delays.

Network failures, timeouts, and Roblox 5xx responses continue to use the existing retry behavior.

The official Roblox endpoint is still attempted first, with the configured proxy fallback used after an exhausted official request. Discovery endpoints do not retry a 429 response repeatedly; they fail over to the proxy and then to the known active-game catalog so a discovery rate limit does not stop player-count collection.

## Historical safety

A retry does not create duplicate historical rows because the collection run keeps a single collectionRunId and the database enforces GameSnapshot uniqueness for a game/run pair.

A collection failure is recorded as failed when the collection cannot complete before snapshots are written. A completed data collection with secondary maintenance errors is recorded as partial so the captured snapshots remain usable.

Ranking refresh is downstream of collection. If refresh fails, the collection log remains a successful or partial collection record and the stored snapshots remain available for later recovery.

## Operational goal

The collector should tolerate temporary Roblox rate limits and transient network/server errors without turning a short upstream incident into unnecessary historical gaps. When discovery is unavailable, the collector may use up to 300 persisted active game IDs as a temporary catalog fallback. Catalog fallback refreshes player counts but does not update activity-observation timestamps or run stale-game verification, preventing a rate-limited discovery source from falsely declaring games observed. Stale-game verification is bounded to 25 candidates per run to avoid a large verification burst.

Longer outages are still recorded explicitly and surfaced by the Phase 4 production health monitoring layer.
