# Bobaks Ranking API

Backend for Bobaks Ranking.

## Stack

- Node.js 20+
- TypeScript
- Express
- PostgreSQL
- Prisma
- Railway

## API

- GET /api/health
- GET /api/rankings/live
- GET /api/rankings/weekly
- GET /api/rankings/monthly
- GET /api/rankings/yearly
- GET /api/games
- GET /api/games/:id/history?days=7
- GET /api/search?q=...

## Local setup

1. Copy .env.example to .env.
2. Set DATABASE_URL.
3. Run npm install.
4. Run npm run db:generate.
5. Run npm run db:push.
6. Run npm run dev.

The Roblox collector and ranking calculations will be added after the API and database connection are verified.
