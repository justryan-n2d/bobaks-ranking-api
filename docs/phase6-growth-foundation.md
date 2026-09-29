# Phase 6: Growth, Discovery & Community

Phase 6 starts from the existing Phase 5 gamer experience and adds the infrastructure needed for discoverable, shareable, measurable growth.

## Implemented in the Phase 6 foundation

### SEO and discovery
- Game pages have real canonical URLs at `/game/{id}`.
- Cloudflare serves the SPA shell through a Worker so direct game URLs can return server-rendered metadata.
- Game pages receive dynamic title, description, canonical, Open Graph, Twitter card, and VideoGame JSON-LD metadata.
- The game HTML includes a text fallback so important game information is present before JavaScript runs.
- `/sitemap.xml` is generated from the active game catalog.
- `/robots.txt` allows the public site and excludes API paths.

### Social distribution
- Existing rank-card sharing now links to the actual Bobaks game page instead of only the homepage.
- Rank-card QR codes use the game page URL as their destination.
- The existing social sharing toolkit remains compatible with native sharing, image download, and caption copy.

### Return loops
- The existing device-local watchlist and comparison flows are retained.
- Shareable period URLs use `/?period=week`, `/?period=month`, and `/?period=year`.
- Game navigation uses browser history so refresh/back/forward preserve shareable game routes.

### Privacy-aware product analytics
Product events are intentionally small and game-level only. The frontend records:
- page views
- searches without storing the search text
- watchlist add/remove
- compare add/remove/view
- rank-card share opens
- ranking shares

Cloudflare Workers Analytics Engine stores the events in the `bobaks_product_web` dataset. The API worker separately records request counts in `bobaks_product_api`.

The implementation does not intentionally send player names, Roblox account IDs, message content, IP addresses, or raw search text in these product events.

### Performance
- Cacheable game, peak, history, and search API responses now expose edge-cache headers.
- Ranking endpoints remain non-cacheable so live ranking freshness is preserved.
- The frontend Worker and Cloudflare Static Assets keep public HTML/assets at the edge.
- Saved and comparison pages continue using bounded client-side lists rather than adding accounts or server-side watchlist storage.

## Still pending in Phase 6

These items should be implemented as separate, evidence-backed follow-up work:
- community/Discord integration
- automated content distribution such as scheduled “Top 10” posts
- game alerts and milestone notifications
- richer return-loop surfaces for daily/weekly movers and new peaks
- deeper analytics reporting for retention/session depth
- infrastructure/storage/cost reporting dashboards
- performance measurement with real production traces and budgets
- abuse controls if public analytics traffic becomes noisy

## Deployment model

The frontend is now a Cloudflare Worker plus Static Assets. The API and collector remain separate Cloudflare Workers, with Supabase continuing as the database and GitHub Actions continuing CI/CD.
