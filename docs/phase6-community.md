# Phase 6.3 Community

## Community hub

The public frontend exposes a crawlable `/community` route with:

- Discord community access
- Feedback
- Feature requests
- Bug reports
- Community polls
- Game discovery

The hub uses the existing Bobaks design system and does not require user accounts or new database tables.

## Discord configuration

The frontend Worker accepts an optional public environment variable:

`DISCORD_INVITE_URL`

When configured, the Community hub uses it for the Discord community, polls, and game-discovery entry points.

When it is not configured:

- The main Discord action clearly reports that the link is not configured.
- Polls fall back to a Bobaks email suggestion link.
- Game discovery falls back to a Bobaks email submission link.

The invite URL is not stored in source code.

## Feedback paths

The Community hub uses `bobaksranking@gmail.com` for:

- general feedback
- feature requests
- bug reports
- poll suggestions when Discord is not configured
- game discovery submissions when Discord is not configured

No player-level account data is collected by these community links.

## Routing and SEO

The frontend Worker server-renders `/community` with:

- Community page title
- Description
- Canonical URL
- Open Graph and Twitter metadata
- Crawlable HTML fallback content

The route is also included in the sitemap.
