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
- GET /api/games
- GET /api/games/:id/history?days=7
- GET /api/search?q=...

### Collector
The collector runs on Cloudflare Workers Cron Triggers and stores Roblox experience data in Supabase.

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

The legacy Node.js/Express/Prisma files are retained temporarily during the Railway retirement process and are not part of the current production request path.
