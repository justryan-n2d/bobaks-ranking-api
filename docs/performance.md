# Part 6.6: Performance

Part 6.6 adds measurable production performance controls without changing ranking formulas or the 50% coverage rule.

## Performance architecture

- Cloudflare Workers Caching is enabled for the frontend Worker.
- Public static assets receive long-lived edge cache headers while HTML stays shorter-lived.
- The browser uses same-origin `/api/...` requests through the frontend Worker.
- The ranking API keeps live ranking responses non-cacheable so freshness is preserved.
- The client keeps a small in-memory GET cache/deduper and uses `no-store` for manual refresh.
- The main application code is a standalone `/app.js` asset.
- The QR generator is loaded only when rank-card sharing is opened.
- The return-loop module is imported after initial rendering instead of being part of the critical HTML path.
- `/api/games` remains bounded to `limit=1..100` plus non-negative `offset` pagination.
- Ranking requests no longer perform a second database query just to calculate the next collection timestamp.

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
