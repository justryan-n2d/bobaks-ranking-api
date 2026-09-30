# Part 6.6: Performance

Part 6.6 adds measurable production performance controls without changing ranking formulas or the 50% coverage rule.

## Performance architecture

- Cloudflare Workers Caching is enabled for the frontend Worker.
- Public static assets receive long-lived edge cache headers while HTML stays shorter-lived.
- The browser uses same-origin `/api/...` requests through the frontend Worker.
- Live ranking responses keep browsers uncacheable (`Cache-Control: no-store`) but use a 5-second Cloudflare edge cache with stale-while-revalidate and stale-if-error, which is small relative to the 10-minute ranking collection cadence.
- The client keeps a small in-memory GET cache/deduper and uses `no-store` for manual refresh.
- The main application code is a standalone `/app.js` asset.
- The QR generator is loaded only when rank-card sharing is opened.
- The return-loop module is imported after initial rendering instead of being part of the critical HTML path.
- `/api/games` remains bounded to `limit=1..100` plus non-negative `offset` pagination.
- Ranking retrieval and collection-schedule metadata retrieval run concurrently to reduce end-to-end API latency.

## Existing database optimization baseline

Phase 4 Part 6.2 already provides production-verified query optimization evidence. Keep that baseline when making later database changes rather than adding speculative indexes.

## Budgets

| Budget | Limit |
| --- | ---: |
| HTML | 70 KB |
| app.js | 80 KB |
| qrcode-generator.js | 60 KB |
| p95 TTFB | 1.5 s |
| p95 total response | 3.0 s |

These are release guardrails, not claims about current production latency.

## Real production traces

`scripts/production-performance-trace.mjs` samples the deployed production site and records:

- TTFB and total response time
- response body size
- Cloudflare cache status
- Cache-Control
- Server-Timing when present

The GitHub Actions workflow runs static budgets on pull requests and runs production traces after successful frontend or API deployments, on scheduled daily runs, and on manual dispatch. Production traces use 20 samples per target by default, which avoids treating one cold-cache request as the entire p95 sample while still recording the maximum observed TTFB separately. It uploads the JSON and Markdown report as a 30-day artifact.

Production measurements are intentionally kept separate from the static code budgets. A code change can pass size checks while a live edge/database path still violates latency budgets.

## Latest production trace

Captured 2026-09-30 at 23:24 UTC from the deployed production frontend and API using 20 samples per target.

| Target | p95 TTFB | p95 total | Max TTFB | Max body |
| --- | ---: | ---: | ---: | ---: |
| Homepage | 55.48 ms | 56.84 ms | 125.15 ms | 44,654 B |
| Weekly page | 185.88 ms | 186.57 ms | 1,329.54 ms | 48,602 B |
| Live ranking API | 1,061.18 ms | 1,063.03 ms | 1,320.59 ms | 106,206 B |
| Game page | 30.68 ms | 31.40 ms | 1,052.79 ms | 46,412 B |
| app.js | 64.51 ms | 65.24 ms | 65.48 ms | 73,312 B |
| qrcode-generator.js | 62.11 ms | 62.68 ms | 69.75 ms | 56,694 B |

All measured p95 latency budgets passed. The live ranking API is below the 1.5 s p95 budget after the production optimization and edge-cache changes. Maximum latency is recorded separately so occasional cold-cache events remain visible without distorting p95.
