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
- GET /api/games
- GET /api/games/:id/history?days=7
- GET /api/search?q=...

### Collector
The collector runs on Cloudflare Workers Cron Triggers and stores Roblox experience data in Supabase.

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


## Ranking transparency

Bobaks publishes the current ranking methodology and a server-side audit summary through the public API:

- GET /api/rankings/methodology
- GET /api/rankings/audit

The website exposes these under **How Bobaks Rankings Work**.