# Bobaks Ranking

Backend and data collection services for Bobaks Ranking.

## Stack

- Cloudflare Workers for the public API and Roblox data collector
- Supabase for PostgreSQL data storage and scheduled database jobs
- GitHub Actions for CI/CD and production smoke tests
- TypeScript

## Production services

### Public API
- GET /api/health
- GET /api/rankings/live
- GET /api/rankings/weekly
- GET /api/rankings/monthly
- GET /api/rankings/yearly
- GET /api/rankings/methodology
- GET /api/rankings/audit
- GET /api/observability?hours=24 (1-168 hours: operational telemetry)
- GET /api/games
- GET /api/games/:id/history?days=7 (1-31 days: raw snapshots; over 31 days: older daily averages plus recent raw snapshots)
- GET /api/search?q=...

### Collector
The collector runs on Cloudflare Workers Cron Triggers and stores Roblox experience data in Supabase.

## Phase 5 gamer experience

Phase 5 adds the core gamer-facing experience: ranking movement, richer game details, daily rank history, trend signals, device-local saved games, side-by-side comparison, shareable rank cards, and visible data/freshness explanations.

The device-local saved list uses browser storage only and does not require an account.

## Ranking methodology

The canonical public explanation of ranking rules, coverage, data qualification, game activity, integrity checks, and limitations is in:

- [docs/ranking-methodology.md](docs/ranking-methodology.md)
- GET /api/rankings/methodology
- GET /api/rankings/audit

The API methodology response is versioned so the website can display the same rules used by the production API.

## Development

Install dependencies:

```bash
npm install
```

Run the automated tests:

```bash
npm test
npm run test:frontend
```

Validate the TypeScript build:

```bash
npm run build
```

## Data retention and storage

Bobaks keeps detailed raw `GameSnapshot` data for 31 days so the database does not grow with every 10-minute collection forever. Long-term history is stored in `DailyGameStat` and `GamePeak`, while operational `DataCollectionLog` rows are retained for 365 days. Retention jobs run daily and protect raw snapshots and referenced collection logs from premature deletion.

The long-term history API combines daily summaries with the retained raw snapshot window, so historical data can continue beyond the raw 31-day window.

Backup and disaster recovery procedures are documented in [docs/backup-disaster-recovery.md](docs/backup-disaster-recovery.md).

Historical recovery behavior and the recovery audit are documented in [docs/historical-recovery.md](docs/historical-recovery.md).

Production health monitoring and incident alerting are documented in [docs/production-health.md](docs/production-health.md). The API exposes liveness and deep health endpoints, GitHub Actions checks the API and collector every 15 minutes, and a separate alerting workflow creates and closes a production incident issue when failures are detected.

Collection reliability behavior is documented in [docs/collection-reliability.md](docs/collection-reliability.md). Roblox 429 responses are retried using `Retry-After` when available, with bounded fallback delays.

## Ranking transparency

Bobaks publishes the current ranking methodology and a server-side audit summary through the public API:

- GET /api/rankings/methodology
- GET /api/rankings/audit

The website exposes these under **How Bobaks Rankings Work**.

## Operational observability

Phase 4 Part 5 exposes read-only operational telemetry through [docs/operational-observability.md](docs/operational-observability.md). The endpoint summarizes collection throughput, run outcomes, duration percentiles, ranking-refresh latency, and observed collection gaps using retained `DataCollectionLog` data.

## Database performance

Phase 4 Part 6.1 and 6.2 production database reliability, baseline, index-audit evidence, and query optimization results are documented in [docs/database-performance.md](docs/database-performance.md). The repeatable read-only baseline is in [database/database-performance-baseline.sql](database/database-performance-baseline.sql), and the evidence-backed index cleanup is in [database/database-performance-hardening.sql](database/database-performance-hardening.sql). Query optimization migrations are recorded under [supabase/migrations/](supabase/migrations/).
