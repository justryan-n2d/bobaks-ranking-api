# Cloudflare Worker Architecture Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested Cloudflare Worker API and scheduled collector that can use Supabase PostgreSQL through Hyperdrive while preserving the existing Node/Express API as the fallback, without changing production yet.

**Architecture:** Add a Worker adapter layer under `worker/` and keep existing ranking, Roblox, peak, validation, and collection behavior in shared services where possible. The Worker will use Hyperdrive for PostgreSQL access and Cron Triggers for collection, while Node/Express continues using Prisma locally and as the fallback API.

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Cron Triggers, Hyperdrive, PostgreSQL/Supabase, node-postgres (`pg`), existing Prisma/Express backend, Node test runner, TypeScript compiler.

## Global Constraints

- Follow the approved design in `docs/specs/2026-09-24-cloudflare-worker-architecture-design.md`.
- Do not migrate Railway data during this implementation phase.
- Do not switch the production API.
- Do not switch the frontend API URL.
- Do not remove Railway.
- Do not remove the Node/Express fallback.
- Do not accept or commit unrelated staged Railway patches.
- Preserve the existing API contract:
  - `GET /api/health`
  - `GET /api/rankings?period=live|week|month|year`
  - `GET /api/games/:id`
  - `GET /api/games/:id/peak`
  - `GET /api/search?q=...`
- Preserve atomic ranking refresh semantics.
- Never commit database credentials or Supabase service keys.
- Keep Supabase RLS enabled.
- Do not expose database credentials to the frontend.
- Cloudflare Cron schedules are UTC.
- The collector schedule is every 5 minutes.
- The Worker must not depend on `setInterval()` or module-level state as a distributed lock.
- The implementation must be tested before the Railway data migration stage.

---

### Task 1: Create a Worker-compatible database and API adapter

**Files:**
- Create: `worker/db.ts`
- Create: `worker/api.ts`
- Create: `worker/index.ts`
- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Modify: `tsconfig.json` if required to type-check Worker files
- Test: `test/worker-api.test.ts` and/or focused Worker adapter tests

**Interfaces:**
- Consumes: existing API behavior in `src/routes/games.ts`, `src/routes/rankings.ts`, and `src/routes/search.ts`; existing JSON-safe response behavior; Supabase PostgreSQL schema.
- Produces: Worker `fetch(request, env, ctx)` handler and a database adapter that accepts the Hyperdrive binding.
- The database adapter must expose the query/transaction operations needed by rankings, games, search, peaks, and collector services without exposing credentials.

- [ ] **Step 1: Add focused failing tests**

Test that the Worker router:
1. Routes `/api/health`.
2. Routes `/api/rankings` and preserves valid period parsing.
3. Routes `/api/games/:id`.
4. Routes `/api/games/:id/peak`.
5. Routes `/api/search?q=...`.
6. Returns the existing 404 response for an unknown path.
7. Converts database failures into the existing API error shapes.
8. Does not require a Railway `DATABASE_URL`.

Use mocked database operations so these tests do not touch Railway or require production data.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm test`

Expected: the new Worker tests fail because the Worker entry point and adapter do not yet exist.

- [ ] **Step 3: Implement the minimum Worker API adapter**

Create `worker/index.ts` with a module-level default handler containing `fetch()`.

Create `worker/api.ts` to route the existing API paths. Keep the HTTP layer independent from Express `Request`/`Response` types.

Create `worker/db.ts` using the current Cloudflare-supported PostgreSQL Worker approach with Hyperdrive and `pg`. The adapter should use `env.HYPERDRIVE` as the connection source and provide the SQL/query/transaction capability required by the API.

Use explicit Worker environment typing for the Hyperdrive binding. Do not hard-code a Hyperdrive ID.

Add `pg` as a runtime dependency at the version required by the current Cloudflare Hyperdrive PostgreSQL guidance.

Update `wrangler.jsonc` to define:
- `main: "worker/index.ts"`
- existing frontend assets
- the 5-minute Cron Trigger
- a Hyperdrive binding placeholder only in the sense of a configuration field that is completed when the actual Hyperdrive resource exists, without inventing an ID

If TypeScript currently excludes Worker files, adjust the compiler configuration without changing the existing Node build output contract.

- [ ] **Step 4: Verify the focused pass**

Run: `npm test`

Expected: existing Node tests and the Worker adapter tests pass.

- [ ] **Step 5: Run the affected build**

Run: `npm run build`

Expected: TypeScript compilation succeeds for the existing Node code and the Worker code according to the repository's final type-check configuration.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add worker package.json package-lock.json wrangler.jsonc tsconfig.json test/worker-api.test.ts
git commit -m "feat: add Cloudflare Worker API adapter"
```

---

### Task 2: Add 30-day snapshot retention and daily aggregation

**Files:**
- Create: `src/services/retention.ts`
- Create or modify: `test/retention.test.ts`
- Modify: `src/services/collector.ts` only where required to invoke retention safely
- Modify: `prisma/schema.prisma` only if implementation reveals a missing constraint/index

**Interfaces:**
- Consumes: `GameSnapshot` and existing `DailyGameStat` schema.
- Produces: a retry-safe retention operation that preserves 5-minute snapshots for the latest 30 days and permanently retains older history as daily statistics.

- [x] **Step 1: Add focused failing tests**

Test that:
1. Snapshots within the 30-day retention window are never deleted.
2. Snapshots older than 30 days are aggregated by game and calendar day.
3. Daily statistics contain average, peak, lowest, and sample count.
4. Aggregation is idempotent and safe to retry.
5. Raw snapshots are deleted only after successful aggregation.
6. A simulated aggregation failure leaves the raw snapshots intact.
7. The retention process does not change current rankings.

- [x] **Step 2: Verify the relevant failure**

Run: `npm test`

Expected: the new retention tests fail because the retention service does not yet exist.

- [x] **Step 3: Implement retention**

Create a shared retention service that:
- uses one explicit timezone consistently for daily boundaries;
- selects only snapshots older than 30 days;
- aggregates them into `DailyGameStat`;
- uses an upsert/unique game-date key so retries do not duplicate daily rows;
- deletes raw snapshots only after successful aggregation;
- keeps `totalSamples` so historical coverage can be evaluated;
- can safely be invoked repeatedly.

The retention service must not require Railway and must work with the database abstraction used by the Worker and Node fallback.

- [x] **Step 4: Verify the focused pass**

Run: `npm test`

Expected: retention tests and all existing tests pass.

- [x] **Step 5: Run the build**

Run: `npm run build`

Expected: TypeScript compilation succeeds.

- [x] **Step 6: Commit the passing deliverable**

```bash
git add src/services/retention.ts test/retention.test.ts src/services/collector.ts prisma/schema.prisma
git commit -m "feat: add 30-day snapshot retention"
```


**Verification:** GitHub Actions passed on commit `b920782c7053f6c86dad3ad4528e41fdb1f8f252`: backend tests, frontend verification, backend build, and Cloudflare Worker build all passed.
---

### Task 3: Move scheduled collection behind the Worker Cron Trigger

**Files:**
- Create: `worker/scheduled.ts`
- Modify: `worker/index.ts`
- Modify: `src/services/collector.ts` only where required to inject a database/client adapter instead of assuming the Prisma singleton
- Create or modify: `test/worker-scheduled.test.ts`
- Modify: `wrangler.jsonc` if Cron configuration was not completed in Task 1

**Interfaces:**
- Consumes: `collectOnce()`, Roblox service functions, peak recording, atomic `refreshRankings()`, and Worker environment/database adapter from Task 1.
- Produces: `scheduled(controller, env, ctx)` that runs one collection cycle and reports failures without corrupting existing rankings.

- [ ] **Step 1: Add focused failing tests**

Test that:
1. A scheduled invocation calls collection exactly once.
2. A collector rejection is surfaced/logged without causing the scheduled handler to create an unhandled rejection.
3. No `setInterval()` is used by the Worker scheduled path.
4. Repeated scheduled invocations do not rely on persistent module state to decide whether collection is running.
5. Existing Node `startCollector()` behavior remains unchanged for the fallback API.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm test`

Expected: the new scheduled tests fail because the Worker scheduled handler is not implemented.

- [ ] **Step 3: Implement the Cron adapter**

Create `worker/scheduled.ts` with the Worker scheduled handler logic.

Refactor collector dependencies only at the boundary required to run the same collection workflow against the Worker database adapter. Preserve:
- game discovery
- universe metadata updates
- snapshot creation
- peak recording
- atomic ranking refresh
- DataCollectionLog success/partial/failed behavior
- existing player-count validation

Do not replace the existing Node interval scheduler.

- [ ] **Step 4: Verify the focused pass**

Run: `npm test`

Expected: Worker scheduled tests and all existing tests pass.

- [ ] **Step 5: Run the build and frontend verification**

Run: `npm run build && npm run test:frontend`

Expected: both commands succeed.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add worker src/services/collector.ts test/worker-scheduled.test.ts wrangler.jsonc
git commit -m "feat: run collector from Cloudflare Cron"
```

---

### Task 4: Test the Worker locally against Supabase without touching Railway

**Files:**
- Modify: `test/` with focused integration/verification tests as needed
- Modify: `docs/specs/2026-09-24-cloudflare-worker-architecture-design.md` only if implementation evidence reveals a design correction
- No Railway files or production configuration should be modified

**Interfaces:**
- Consumes: Worker API and scheduled handler from Tasks 1, 2, and 3, Supabase schema, Hyperdrive-compatible database configuration.
- Produces: verified local Worker behavior and a repeatable test path for the API and Cron Trigger.

- [ ] **Step 1: Add focused integration checks**

Cover:
1. `/api/health` reports database connectivity.
2. `/api/rankings?period=live` returns the expected envelope.
3. `/api/rankings?period=week|month|year` preserves the period mapping.
4. `/api/games` and `/api/games/:id` return data or the expected empty/not-found response.
5. `/api/games/:id/peak` returns the expected peak response.
6. `/api/search?q=...` returns the expected search envelope.
7. Invalid `period`, `days`, game IDs, and missing/overlong search queries preserve existing validation behavior.
8. Local Cron Trigger invocation reaches `scheduled()`.
9. A collector failure writes a failed collection log when the database is available.
10. A ranking refresh failure leaves the previous rankings unchanged.

Tests that require a live Supabase connection must be opt-in through an explicit environment variable and must never use Railway production credentials.

- [ ] **Step 2: Run the focused checks**

Run: `npm test`

Expected: all unit tests pass.

For the Supabase-backed check, run the Worker locally with the documented Wrangler local scheduled-trigger path and the test Supabase connection.

Expected: health, API routes, and scheduled collection execute against Supabase.

- [ ] **Step 3: Run the full verification gate**

Run:
```bash
npm test
npm run test:frontend
npm run build
npx wrangler deploy --dry-run
```

Expected:
- backend tests pass
- frontend verification passes
- TypeScript build passes
- Wrangler validates the Worker configuration without requiring a production deployment

- [ ] **Step 4: Commit the verified test coverage**

```bash
git add test docs/specs/2026-09-24-cloudflare-worker-architecture-design.md
git commit -m "test: verify Cloudflare Worker against Supabase"
```

The documentation should only be modified if an actual implementation detail differs from the approved design.

---

### Task 5: Final pre-migration gate and handoff

**Files:**
- Modify: `docs/plans/2026-09-24-cloudflare-worker-architecture.md` only to record verified commands/results if the project convention requires it
- No Railway production configuration changes

**Interfaces:**
- Consumes: all Worker API, retention, Cron, database, and test deliverables from Tasks 1 through 4.
- Produces: a verified implementation ready for the separate Railway data migration stage.

- [ ] **Step 1: Run the complete verification suite**

Run:
```bash
npm test
npm run test:frontend
npm run build
npx wrangler deploy --dry-run
```

Expected: every command succeeds.

- [ ] **Step 2: Verify production isolation**

Confirm that:
- no Railway deployment was triggered by the Worker work
- no Railway database rows were changed
- no frontend API URL was changed
- no secrets were committed
- no unrelated staged Railway patch was accepted

- [ ] **Step 3: Verify API compatibility**

Confirm that the Worker and Node fallback expose the same documented endpoint paths and compatible response envelopes for health, rankings, games, peaks, and search.

- [ ] **Step 4: Stop before migration**

Do not migrate Railway data in this plan.

The next approved stage begins only after the Worker testing gate passes:

`Migrate Railway data -> Verify data -> Switch API -> Switch frontend`.

- [ ] **Step 5: Commit the final pre-migration verification**

```bash
git add docs/plans/2026-09-24-cloudflare-worker-architecture.md
git commit -m "docs: finalize Cloudflare Worker migration plan"
```

## Unresolved externally observable decisions

- The actual Cloudflare Hyperdrive resource ID must be supplied by the Cloudflare environment when the binding is created. It must not be invented or committed before creation.
- The exact `pg` connection-pooling settings should follow the current Cloudflare Hyperdrive PostgreSQL guidance and the observed Worker runtime behavior during implementation.
- The exact live-Supabase integration-test invocation should use the available secure environment configuration and must not expose credentials in repository files.
