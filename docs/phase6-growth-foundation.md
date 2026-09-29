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
- Ranking-list sharing supports Live, Weekly, Monthly, and Yearly Top 10 content.
- Trending Games sharing reuses the existing upward rank-movement signal.
- Peak Records sharing exposes the highest recorded Bobaks peaks without inventing new historical data.
- The UI consumes the read-only /api/social/feed endpoint for server-generated, automation-ready social posts.
- The existing social sharing toolkit remains compatible with native sharing, image download, and caption copy.

### Return loops
- The existing device-local watchlist remains bounded at 25 saved games.
- Daily rankings remain directly accessible from the live ranking surface.
- Weekly changes and biggest movers are surfaced through a return hub that links into the weekly ranking route.
- New peak detection uses the existing read-only peak feed and a local observation baseline; first-seen peaks are treated as a baseline rather than a new alert.
- Saved-game alerts are device-local and currently cover Top 10 entry, new recorded peaks, and jumps of 5 or more ranking places.
- Alert preferences are stored per saved game without accounts or server-side player-level data.
- Historical milestone cards on game pages derive first recorded date, recorded peak, best rank, first Top 10 date, and historical days from existing history endpoints.
- Alerts are checked when the user revisits Bobaks rather than using background push notifications.
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
- enable the shipped Discord publisher by configuring the repository secret
- add additional third-party publishers only when their credentials, APIs, and permissions are explicitly configured
- community/Discord integration
- game alerts and milestone notifications
- richer return-loop surfaces for daily/weekly movers and new peaks
- deeper analytics reporting for retention/session depth
- infrastructure/storage/cost reporting dashboards
- performance measurement with real production traces and budgets
- abuse controls if public analytics traffic becomes noisy

## Deployment model

The frontend is now a Cloudflare Worker plus Static Assets. The API and collector remain separate Cloudflare Workers, with Supabase continuing as the database and GitHub Actions continuing CI/CD.


## Phase 6.2 social content feed

The API exposes a read-only automation seam:

- GET /api/social/feed?period=live|week|month|year
- Returns Top 10 ranking items, upward-moving trending items, and highest recorded peak items.
- Returns ready-to-post text for ranking, trending, and peak-record content.
- Ranking and trending post links use the canonical public ranking URL for the selected period.
- Peak posts link directly to the affected Bobaks game pages.
- The endpoint uses existing Ranking and GamePeak data only.
- The endpoint does not publish to external social platforms or store third-party credentials.

The social feed is now consumed by a scheduled GitHub Actions content-generation workflow. The generated Top 10, Trending, and Peak Records text files are uploaded as a short-lived artifact for downstream publishing workflows.

Actual third-party publishing remains separate so Bobaks can add platform-specific credentials and permissions deliberately.


## Phase 6.2 scheduled content generation

The repository now has `.github/workflows/social-content-generation.yml`, which runs daily at 00:30 UTC and can also be started manually. It fetches all four ranking periods from `/api/social/feed`, generates Top 10 and Trending post files plus a Peak Records file, and uploads them as the `bobaks-social-content` artifact with 14-day retention.


## Phase 6.2 Discord publishing

The social content workflow now includes an optional Discord webhook publisher. It reads DISCORD_SOCIAL_WEBHOOK_URL from a GitHub Actions repository secret and publishes selected generated content to the configured Discord channel.

Publishing behavior:
- Daily: Top 10 live rankings and live trending content
- Mondays (UTC): also publish the weekly Top 10 ranking
- Peak Records remain generated and manually shareable, but are not auto-posted by default
- Missing webhook secret: publishing is skipped safely and content generation still succeeds
- Webhook failures fail the publishing step rather than being silently treated as a successful post

The publisher enforces Discord's 2,000-character message limit by splitting oversized content into separate messages. Discord documents webhooks as an automation mechanism for sending messages to a selected server channel. 
