# Bobaks Ranking Cloudflare Worker Architecture

## Status
Approved design for implementation.

This design prepares Bobaks Ranking for a hybrid architecture in which Cloudflare Workers becomes the future production API and scheduled collector, while the existing Node/Express API remains available as a local and production fallback.

## Goals
- Add a Cloudflare Worker API without switching production yet.
- Run the Roblox collector through a Cloudflare Cron Trigger.
- Keep Node/Express + Prisma working as the fallback implementation.
- Connect the Worker to the existing Supabase PostgreSQL database through Cloudflare Hyperdrive.
- Preserve the existing public API contract.
- Test the Worker and collector against the Supabase schema before touching Railway production data.
- Keep Railway production unchanged during this phase.
- Retain detailed 5-minute snapshots for the most recent 30 days while preserving older history as daily statistics.

## Non-goals
- Migrating Railway data.
- Switching the production API.
- Switching the frontend API URL.
- Removing Railway.
- Removing the Node/Express implementation.
- Redesigning the existing ranking algorithms.
- Keeping unlimited raw 5-minute snapshots forever.

## Snapshot retention and daily aggregation
Raw GameSnapshot data is retained at 5-minute granularity for the most recent 30 days.

For snapshots older than 30 days:
1. Group snapshots by game and calendar day using one explicitly defined timezone.
2. Calculate and upsert DailyGameStat values: averagePlayers, peakPlayers, lowestPlayers, and totalSamples.
3. Only after successful aggregation, delete the corresponding raw snapshots.
4. Keep DailyGameStat records as the long-term historical representation.
5. Run cleanup once per day rather than every 5-minute collection cycle.
6. Make aggregation/deletion retry-safe and avoid deleting raw data when aggregation fails.
The retention process must preserve totalSamples so historical coverage can be evaluated.

## Scheduled collector
The Cloudflare Worker will use scheduled() instead of setInterval(). The Worker collector schedule is now intended to be every 5 minutes. The Node fallback may continue using its existing interval scheduler.

## Failure handling
- Retention aggregates before deleting raw snapshots.
- A retention failure must leave raw snapshots intact for retry.
- Existing atomic ranking refresh behavior must be preserved.

## Testing gates
- Verify daily statistics are created from old snapshots before raw deletion.
- Verify retention failure leaves raw snapshots intact.
- Verify 5-minute collection scheduling.
- Verify existing backend, frontend, Worker, and Supabase tests continue to pass.

## Cost and limits
The 30-day raw snapshot retention is intended to control PostgreSQL growth while preserving detailed recent history. Actual Worker, Hyperdrive, Supabase, and Roblox API usage must be measured before declaring free tiers sufficient long-term.

## Implementation constraints
- Do not change Railway production during this phase.
- Do not accept or commit unrelated staged Railway patches.
- Do not switch the frontend API URL yet.
- Do not migrate Railway data until all Worker testing gates pass.