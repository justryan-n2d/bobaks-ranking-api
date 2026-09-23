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

## Non-goals
- Migrating Railway data.
- Switching the production API.
- Switching the frontend API URL.
- Removing Railway.
- Removing the Node/Express implementation.
- Redesigning the existing ranking algorithms.

## Architecture
Production target:

    Client
      |
      v
    Cloudflare Worker
      |-- fetch() -> API adapter -> shared services -> Supabase PostgreSQL
      |
      `-- scheduled() -> collector adapter -> shared collector -> Roblox APIs
                                             |
                                             v
                                       Supabase PostgreSQL

Fallback/local:

    Node/Express -> shared services -> Prisma -> Supabase PostgreSQL

The Worker and Node entry points are adapters. Ranking, validation, Roblox integration, peak tracking, and collector behavior should remain in shared services where practical.

## Repository structure
    src/
      config/database.ts
      routes/
      services/
      utils/
      server.ts
      collector.ts

    worker/
      index.ts
      api.ts
      scheduled.ts
      db.ts

    frontend/
    prisma/schema.prisma
    test/
    docs/specs/
    wrangler.jsonc

The exact shared-service boundaries may be adjusted during implementation if an existing module couples directly to Node/Prisma.

## Worker API
The Worker must preserve the existing API contract:
- GET /api/health
- GET /api/rankings?period=live
- GET /api/rankings?period=week
- GET /api/rankings?period=month
- GET /api/rankings?period=year
- GET /api/games/:id
- GET /api/games/:id/peak
- GET /api/search?q=...

The response shapes should remain compatible with the existing frontend unless a change is required by the Worker runtime.

## Database architecture
The Worker will access Supabase PostgreSQL through Cloudflare Hyperdrive.

    Cloudflare Worker
          |
          v
      Hyperdrive
          |
          v
    Supabase PostgreSQL

The Worker must not expose Supabase service credentials to clients.
The Node/Express fallback will continue using Prisma and DATABASE_URL.
The Worker database adapter must not assume that the existing Node Prisma client can run unchanged in the Workers runtime.
Cloudflare's current PostgreSQL guidance supports Hyperdrive for PostgreSQL connections from Workers. The implementation should use the current documented Worker-compatible driver configuration and generate/update Wrangler types as appropriate.

## Wrangler configuration
The Worker configuration will define:
- Worker entry point.
- Frontend static assets.
- Hyperdrive binding.
- Cron Trigger.
- A current compatibility date.
- Worker-compatible Node.js runtime support required by the selected PostgreSQL driver.

The collector schedule is initially intended to be every 10 minutes:
    */10 * * * *

Cron schedules are interpreted in UTC.
The actual Hyperdrive ID will be configured only after the Hyperdrive resource exists. No database credentials or IDs will be hard-coded in source.

## Scheduled collector
The Cloudflare Worker will use a scheduled(controller, env, ctx) handler instead of setInterval().
The scheduled handler will call the shared collector once per invocation.
The Node fallback may continue using its existing interval-based startCollector() behavior.
The Worker must not rely on module-level state such as collectionInProgress as a distributed lock. Collection operations must remain safe if an invocation is retried or overlaps.

The existing collector workflow remains:
1. Discover Roblox universe IDs.
2. Retrieve universe information.
3. Retrieve thumbnails.
4. Upsert game metadata.
5. Write game snapshots.
6. Record persistent peaks.
7. Refresh rankings atomically.
8. Record DataCollectionLog status.
9. Preserve existing rankings if ranking refresh fails.

## Failure handling
- API failures must return appropriate HTTP error responses.
- Collector failures must be logged in DataCollectionLog when possible.
- A failed ranking refresh must not leave a partially replaced ranking set.
- Existing atomic ranking refresh behavior must be preserved.
- A collector failure must not erase previously valid rankings.
- The next scheduled invocation must be able to retry.
- Node/Express remains available as the fallback API.

## Testing gates
Before Railway data migration, implementation must verify:
1. TypeScript/build succeeds.
2. Existing Node backend tests pass.
3. Existing frontend verification passes.
4. Worker starts successfully with Wrangler.
5. Worker /api/health responds correctly.
6. Worker ranking endpoints respond against the Supabase test database.
7. Worker game and search endpoints respond against the Supabase test database.
8. Cloudflare scheduled() can be triggered locally.
9. Scheduled collector can execute against the Supabase test database.
10. Snapshots, peaks, rankings, and collection logs are written as expected.
11. A simulated ranking-refresh failure leaves the previous ranking set intact.
12. Node/Express fallback tests continue to pass.
13. No Railway production data is modified by these tests.

Cloudflare documents local Cron Trigger testing through /cdn-cgi/local/scheduled and Wrangler.

## Production migration sequence
The approved migration order is:
1. Supabase DB
2. Prepare API
3. Test locally
4. Prepare Cloudflare Worker
5. Test Worker
6. Migrate Railway data
7. Verify data
8. Switch API to Cloudflare
9. Switch frontend

This Worker phase must stop before step 6.

## Rollback strategy
After Cloudflare becomes production:
- Node/Express + Prisma remains available as the fallback API.
- The frontend API base URL can be reverted to the Node API if required.
- Supabase remains the intended production database.
- Railway is not considered the permanent architecture after a successful migration, but it is not removed until the migration has been verified and the fallback strategy is confirmed.

## Security
- Never commit database passwords, Supabase service keys, Hyperdrive connection strings, or other secrets.
- Worker secrets/bindings must be used for sensitive configuration.
- Supabase RLS remains enabled on the public tables.
- The public frontend must not receive database credentials.
- Any future direct browser access to Supabase must have explicit RLS policies before exposure.

## Cost and limits
The design intentionally uses Cloudflare Workers plus Hyperdrive rather than adding another always-running collector server.
During implementation, actual Worker invocation, Hyperdrive query, Supabase database, and Roblox API usage should be measured before declaring the free tiers sufficient for long-term production.

## Implementation constraints
- Do not change Railway production during this phase.
- Do not accept or commit unrelated staged Railway patches.
- Do not switch the frontend API URL yet.
- Do not delete the Node/Express implementation.
- Do not migrate Railway data until all Worker testing gates pass.
