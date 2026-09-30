import { authorizeAdminAnalytics, fetchAdminAnalytics, parseAnalyticsRange } from "./admin-analytics";
interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface AnalyticsBinding {
  writeDataPoint(data: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface Env {
  ASSETS: AssetBinding;
  API_ORIGIN: string;
  DISCORD_INVITE_URL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ANALYTICS?: AnalyticsBinding;
}

type FetchLike = typeof fetch;
type Json = Record<string, unknown>;

const EVENTS = new Set([
  "page_view",
  "search_used",
  "watchlist_add",
  "watchlist_remove",
  "compare_add",
  "compare_remove",
  "compare_view",
  "saved_view",
  "share_opened",
  "ranking_share"
]);

const PERIODS = new Set(["live", "week", "month", "year"]);

const COMMUNITY_META = {
  title: "Bobaks Ranking Community | Discord, Feedback & Game Discovery",
  description: "Join the Bobaks Ranking community, share feedback, request features, report bugs, and discuss Roblox game discovery."
};

const RANKING_ROUTES: Record<string, string> = {
  "/rankings/weekly": "week",
  "/rankings/monthly": "month",
  "/rankings/yearly": "year"
};

const RANKING_META: Record<string, { title: string; description: string; label: string }> = {
  live: {
    title: "Live Roblox Game Rankings | Bobaks Ranking",
    description: "See the latest live Roblox experience rankings, player counts, and rank movement collected by Bobaks Ranking.",
    label: "Live Roblox Game Rankings"
  },
  week: {
    title: "This Week's Roblox Game Rankings | Bobaks Ranking",
    description: "See this week's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking.",
    label: "This Week's Roblox Game Rankings"
  },
  month: {
    title: "This Month's Roblox Game Rankings | Bobaks Ranking",
    description: "See this month's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking.",
    label: "This Month's Roblox Game Rankings"
  },
  year: {
    title: "This Year's Roblox Game Rankings | Bobaks Ranking",
    description: "See this year's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking.",
    label: "This Year's Roblox Game Rankings"
  }
};

function rankingPeriodForPath(pathname: string): string | null {
  return RANKING_ROUTES[pathname] ?? null;
}

function rankingCanonicalPath(period: string): string {
  if (period === "week") return "/rankings/weekly";
  if (period === "month") return "/rankings/monthly";
  if (period === "year") return "/rankings/yearly";
  return "/";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char] ?? char));
}

function escapeXml(value: unknown): string {
  return escapeHtml(value).replace(/&#39;/g, "&apos;");
}

function cleanDescription(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (text || fallback).slice(0, 160);
}

function canonicalGameUrl(origin: string, id: string): string {
  return new URL("/game/" + encodeURIComponent(id), origin).toString();
}

function normalizeRoute(pathname: string): string {
  if (pathname === "/" || pathname === "/saved" || pathname === "/compare" || pathname === "/community") return pathname;
  if (/^\/game\/\d+$/.test(pathname)) return "/game/:id";
  return pathname.startsWith("/info") ? "/info" : "/other";
}

function recordAnalytics(env: Env, event: string, data: {
  route?: string;
  period?: string;
  gameId?: string;
  channel?: string;
  visitorId?: string;
  sessionId?: string;
}): void {
  if (!env.ANALYTICS || !EVENTS.has(event)) return;

  try {
    const period = PERIODS.has(data.period ?? "") ? String(data.period) : "";
    const gameId = data.gameId && /^\d{1,20}$/.test(data.gameId) ? data.gameId : "";
    const channel = data.channel ? String(data.channel).slice(0, 32) : "";
    const visitorId = data.visitorId && /^[a-f0-9]{32}$/i.test(data.visitorId) ? data.visitorId.toLowerCase() : "";
    const sessionId = data.sessionId && /^[a-f0-9]{32}$/i.test(data.sessionId) ? data.sessionId.toLowerCase() : "";

    env.ANALYTICS.writeDataPoint({
      blobs: [event, normalizeRoute(String(data.route ?? "/")), period, gameId, channel, visitorId, sessionId],
      doubles: [1],
      indexes: [event]
    });
  } catch (error) {
    console.warn("Product analytics write failed:", error);
  }
}

async function assetShell(env: Env, request: Request): Promise<Response> {
  return env.ASSETS.fetch(
    new Request(new URL("/index.html", request.url).toString())
  );
}

function replaceTagById(html: string, id: string, tag: string): string {
  const escapedId = id.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:meta|link)[^>]*\\bid=["\']${escapedId}["\'][^>]*>`,
    "i"
  );
  return html.replace(pattern, tag);
}

function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

async function fetchGame(
  env: Env,
  gameId: string,
  fetchImpl: FetchLike
): Promise<{ game: Json; peak: Json | null } | null> {
  const base = env.API_ORIGIN.replace(/\/$/, "");
  const [gameResponse, peakResponse] = await Promise.all([
    fetchImpl(base + "/api/games/" + encodeURIComponent(gameId), {
      headers: { accept: "application/json" }
    }),
    fetchImpl(base + "/api/games/" + encodeURIComponent(gameId) + "/peak", {
      headers: { accept: "application/json" }
    })
  ]);

  if (gameResponse.status === 404) return null;
  if (!gameResponse.ok) {
    throw new Error("Game API unavailable: " + gameResponse.status);
  }

  const gameBody = await gameResponse.json() as { data?: Json };
  if (!gameBody.data) return null;

  let peak: Json | null = null;
  if (peakResponse.ok) {
    const peakBody = await peakResponse.json() as { data?: Json };
    peak = peakBody.data ?? null;
  }

  return { game: gameBody.data, peak };
}

async function renderGamePage(
  request: Request,
  env: Env,
  gameId: string,
  fetchImpl: FetchLike
): Promise<Response> {
  const result = await fetchGame(env, gameId, fetchImpl);

  if (!result) {
    return new Response("Game not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60"
      }
    });
  }

  const shell = await assetShell(env, request);
  if (!shell.ok) return shell;

  const game = result.game;
  const name = String(game.name ?? "Unknown game");
  const canonical = canonicalGameUrl(new URL(request.url).origin, gameId);
  const description = cleanDescription(
    game.description,
    "Current players, Bobaks rank, recorded peak, and historical trends for " + name + "."
  );
  const image = String(
    game.iconUrl ?? new URL("/assets/bobaks-logo.png", request.url).toString()
  );
  const rankings = game.rankings && typeof game.rankings === "object"
    ? game.rankings as Json
    : null;
  const liveRanking = rankings?.live && typeof rankings.live === "object"
    ? rankings.live as Json
    : null;
  const currentPlayers = Number(game.currentPlayers ?? liveRanking?.score ?? 0) || 0;
  const rank = Number(liveRanking?.rank ?? 0) || null;
  const peakPlayers = Number(result.peak?.peakPlayers ?? 0) || 0;
  const creator = String(game.creatorName ?? "Unknown creator");
  const jsonLd = safeJsonLd({
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name,
    url: canonical,
    image: [image],
    description,
    author: { "@type": "Organization", name: creator },
    dateCreated: game.createdAt ?? undefined,
    dateModified: game.updatedAt ?? undefined
  });

  let output = await shell.text();
  output = output
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(name) + " | Bobaks Ranking</title>")
    .replace(/<meta id="seo-description"[^>]*>/i, '<meta id="seo-description" name="description" content="' + escapeHtml(description) + '">')
    .replace(/<link id="seo-canonical"[^>]*>/i, '<link id="seo-canonical" rel="canonical" href="' + escapeHtml(canonical) + '">');

  output = replaceTagById(output, "seo-og-title",
    '<meta id="seo-og-title" property="og:title" content="' + escapeHtml(name + " | Bobaks Ranking") + '">');
  output = replaceTagById(output, "seo-og-description",
    '<meta id="seo-og-description" property="og:description" content="' + escapeHtml(description) + '">');
  output = replaceTagById(output, "seo-og-url",
    '<meta id="seo-og-url" property="og:url" content="' + escapeHtml(canonical) + '">');
  output = replaceTagById(output, "seo-og-image",
    '<meta id="seo-og-image" property="og:image" content="' + escapeHtml(image) + '">');
  output = replaceTagById(output, "seo-twitter-title",
    '<meta id="seo-twitter-title" name="twitter:title" content="' + escapeHtml(name + " | Bobaks Ranking") + '">');
  output = replaceTagById(output, "seo-twitter-description",
    '<meta id="seo-twitter-description" name="twitter:description" content="' + escapeHtml(description) + '">');
  output = replaceTagById(output, "seo-twitter-image",
    '<meta id="seo-twitter-image" name="twitter:image" content="' + escapeHtml(image) + '">');

  const fallbackHtml =
    '<section class="seo-fallback"><div class="eyebrow">BOBAKS GAME PAGE</div><h1>' +
    escapeHtml(name) + '</h1><p>by ' + escapeHtml(creator) + '</p><p>' +
    escapeHtml(description) + '</p><p>Current players: <strong>' +
    String(Math.max(0, Math.round(currentPlayers))) +
    '</strong>' + (rank ? ' · Bobaks Live Rank: <strong>#' + rank + '</strong>' : '') +
    (peakPlayers ? ' · Recorded Peak: <strong>' + String(Math.round(peakPlayers)) + '</strong>' : '') +
    '</p><p><a href="' + escapeHtml(canonical) + '">Open this Bobaks game page</a></p></section>';

  output = output
    .replace(/<main id="app" class="wrap"><\/main>/i,
      '<main id="app" class="wrap">' + fallbackHtml + '</main>')
    .replace(/<\/head>/i, '<script type="application/ld+json">' + jsonLd + '</script></head>');

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=300, s-maxage=600");
  headers.set("x-robots-tag", "index, follow");

  return new Response(output, { status: 200, headers });
}

async function renderCommunityPage(
  request: Request,
  env: Env
): Promise<Response> {
  const shell = await assetShell(env, request);
  if (!shell.ok) return shell;

  const origin = new URL(request.url).origin;
  const canonical = origin + "/community";
  const discordUrl = String(env.DISCORD_INVITE_URL ?? "").trim();
  const discordReady = Boolean(discordUrl);
  const discordAction = discordReady
    ? '<a class="btn primary" href="' + escapeHtml(discordUrl) + '" target="_blank" rel="noreferrer noopener">Join Discord</a>'
    : '<span class="btn community-disabled" aria-disabled="true">Discord link is not configured yet.</span>';
  const pollAction = discordReady
    ? '<a class="btn primary" href="' + escapeHtml(discordUrl) + '" target="_blank" rel="noreferrer noopener">Open Discord</a>'
    : '<a class="btn" href="mailto:bobaksranking@gmail.com?subject=Community%20poll">Suggest a poll</a>';
  const discoveryAction = discordReady
    ? '<a class="btn primary" href="' + escapeHtml(discordUrl) + '" target="_blank" rel="noreferrer noopener">Open Discord</a>'
    : '<a class="btn" href="mailto:bobaksranking@gmail.com?subject=Game%20discovery">Send a game</a>';

  const fallbackHtml =
    '<section class="hero"><div class="hero-main"><div class="eyebrow">BOBAKS COMMUNITY</div><h1>Build Bobaks <em>with us</em></h1><p>Talk about Roblox games, share ideas, report problems, and help shape what Bobaks builds next.</p></div></section>' +
    '<section class="community-grid">' +
      '<article class="community-card community-primary"><div class="community-icon" aria-hidden="true">D</div><div><div class="community-label">COMMUNITY HOME</div><h2>Discord community</h2><p>Chat with other gamers, discuss rankings, share discoveries, and take part in Bobaks community activity.</p></div>' + discordAction + '</article>' +
      '<article class="community-card"><div class="community-icon" aria-hidden="true">F</div><div><h2>Feedback</h2><p>Tell us what is useful, confusing, missing, or worth improving.</p></div><a class="btn" href="mailto:bobaksranking@gmail.com?subject=Bobaks%20Feedback">Send feedback</a></article>' +
      '<article class="community-card"><div class="community-icon" aria-hidden="true">F</div><div><h2>Feature requests</h2><p>Suggest a feature and explain what problem it would solve for you.</p></div><a class="btn" href="mailto:bobaksranking@gmail.com?subject=Bobaks%20Feature%20Request">Request a feature</a></article>' +
      '<article class="community-card"><div class="community-icon" aria-hidden="true">B</div><div><h2>Bug reports</h2><p>Report a broken page, wrong display, or other issue with the page URL included.</p></div><a class="btn" href="mailto:bobaksranking@gmail.com?subject=Bobaks%20Bug%20Report">Report a bug</a></article>' +
      '<article class="community-card"><div class="community-icon" aria-hidden="true">P</div><div><h2>Community polls</h2><p>Help guide future improvements and vote on community questions through Discord when the server link is configured.</p></div>' + pollAction + '</article>' +
      '<article class="community-card"><div class="community-icon" aria-hidden="true">G</div><div><h2>Game discovery</h2><p>Share Roblox experiences you think Bobaks should track or discuss with the community.</p></div>' + discoveryAction + '</article>' +
    '</section>' +
    '<section class="panel community-note"><h2>Keep reports useful</h2><p>For bug reports, include the Bobaks page URL, what you expected, and what happened. For feature requests, describe the problem first so the community can discuss the need behind the idea.</p></section>' +
    '<footer class="foot"><div>Bobaks Ranking · Independent fan-made analytics site · Not affiliated with Roblox Corporation.</div><div><a href="/">Rankings</a></div></footer>';

  let output = await shell.text();
  output = output
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(COMMUNITY_META.title) + "</title>")
    .replace(/<meta id="seo-description"[^>]*>/i,
      '<meta id="seo-description" name="description" content="' + escapeHtml(COMMUNITY_META.description) + '">')
    .replace(/<link id="seo-canonical"[^>]*>/i,
      '<link id="seo-canonical" rel="canonical" href="' + escapeHtml(canonical) + '">');

  output = replaceTagById(output, "seo-og-title",
    '<meta id="seo-og-title" property="og:title" content="' + escapeHtml(COMMUNITY_META.title) + '">');
  output = replaceTagById(output, "seo-og-description",
    '<meta id="seo-og-description" property="og:description" content="' + escapeHtml(COMMUNITY_META.description) + '">');
  output = replaceTagById(output, "seo-og-url",
    '<meta id="seo-og-url" property="og:url" content="' + escapeHtml(canonical) + '">');
  output = replaceTagById(output, "seo-twitter-title",
    '<meta id="seo-twitter-title" name="twitter:title" content="' + escapeHtml(COMMUNITY_META.title) + '">');
  output = replaceTagById(output, "seo-twitter-description",
    '<meta id="seo-twitter-description" name="twitter:description" content="' + escapeHtml(COMMUNITY_META.description) + '">');

  output = output
    .replace(/<main id="app" class="wrap"><\/main>/i,
      '<main id="app" class="wrap">' + fallbackHtml + '</main>')
    .replace(/<\/head>/i,
      '<script>window.__BOBAKS_COMMUNITY__=' + safeJsonLd({ discordInviteUrl: discordUrl }) + ';</script></head>');

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=300, s-maxage=600");
  headers.set("x-robots-tag", "index, follow");

  return new Response(output, { status: 200, headers });
}

async function renderRankingPage(
  request: Request,
  env: Env,
  period: string,
  fetchImpl: FetchLike
): Promise<Response> {
  const base = env.API_ORIGIN.replace(/\/$/, "");
  const response = await fetchImpl(base + "/api/rankings?period=" + encodeURIComponent(period), {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    return new Response("Ranking page unavailable", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const body = await response.json() as { data?: Json[] };
  const rows = (body.data ?? []).filter(row => /^\d+$/.test(String(row.gameId ?? ""))).slice(0, 10);
  const origin = new URL(request.url).origin;
  const meta = RANKING_META[period] ?? RANKING_META.live;
  const canonical = new URL(rankingCanonicalPath(period), origin).toString();
  const items = rows.map((row, index) => {
    const id = String(row.gameId);
    const rank = Number(row.rank) || index + 1;
    const game = row.game && typeof row.game === "object" ? row.game as Json : {};
    return {
      rank,
      id,
      name: String(game.name ?? "Unknown game"),
      creator: String(game.creatorName ?? "Unknown creator"),
      score: Number(row.score ?? 0) || 0
    };
  });

  const shell = await assetShell(env, request);
  if (!shell.ok) return shell;

  const jsonLd = safeJsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: meta.title,
    url: canonical,
    description: meta.description,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map(item => ({
        "@type": "ListItem",
        position: item.rank,
        name: item.name,
        url: canonicalGameUrl(origin, item.id)
      }))
    }
  });

  const list = items.length
    ? "<ol>" + items.map(item =>
        '<li><a href="' + escapeHtml(canonicalGameUrl(origin, item.id)) + '">' +
        escapeHtml(item.name) + "</a><span> by " + escapeHtml(item.creator) +
        " · " + String(Math.max(0, Math.round(item.score))) + " players</span></li>"
      ).join("") + "</ol>"
    : "<p>No ranking rows are available right now.</p>";

  let output = await shell.text();
  output = output
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(meta.title) + "</title>")
    .replace(/<meta id="seo-description"[^>]*>/i,
      '<meta id="seo-description" name="description" content="' + escapeHtml(meta.description) + '">')
    .replace(/<link id="seo-canonical"[^>]*>/i,
      '<link id="seo-canonical" rel="canonical" href="' + escapeHtml(canonical) + '">');

  output = replaceTagById(output, "seo-og-title",
    '<meta id="seo-og-title" property="og:title" content="' + escapeHtml(meta.title) + '">');
  output = replaceTagById(output, "seo-og-description",
    '<meta id="seo-og-description" property="og:description" content="' + escapeHtml(meta.description) + '">');
  output = replaceTagById(output, "seo-og-url",
    '<meta id="seo-og-url" property="og:url" content="' + escapeHtml(canonical) + '">');
  output = replaceTagById(output, "seo-twitter-title",
    '<meta id="seo-twitter-title" name="twitter:title" content="' + escapeHtml(meta.title) + '">');
  output = replaceTagById(output, "seo-twitter-description",
    '<meta id="seo-twitter-description" name="twitter:description" content="' + escapeHtml(meta.description) + '">');
  output = replaceTagById(output, "seo-twitter-image",
    '<meta id="seo-twitter-image" name="twitter:image" content="' +
      escapeHtml(new URL("/assets/bobaks-logo.png", request.url).toString()) + '">');

  const fallbackHtml =
    '<section class="seo-fallback"><div class="eyebrow">BOBAKS RANKINGS</div><h1>' +
    escapeHtml(meta.label) + '</h1><p>' + escapeHtml(meta.description) +
    '</p><p>Explore the latest ranking snapshot and open any game for its full Bobaks history.</p>' +
    list + '</section>';

  output = output
    .replace(/<main id="app" class="wrap"><\/main>/i,
      '<main id="app" class="wrap">' + fallbackHtml + '</main>')
    .replace(/<\/head>/i, '<script type="application/ld+json">' + jsonLd + '</script></head>');

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=60, s-maxage=300");
  headers.set("x-robots-tag", "index, follow");

  return new Response(output, { status: 200, headers });
}

async function renderSitemap(
  request: Request,
  env: Env,
  fetchImpl: FetchLike
): Promise<Response> {
  const base = env.API_ORIGIN.replace(/\/$/, "");
  const GAME_PAGE_SIZE = 100;
  const gameRows: Json[] = [];
  let offset = 0;

  while (true) {
    const gamesUrl = new URL(base + "/api/games");
    gamesUrl.searchParams.set("limit", String(GAME_PAGE_SIZE));
    gamesUrl.searchParams.set("offset", String(offset));

    try {
      const response = await fetchImpl(gamesUrl.toString(), {
        headers: { accept: "application/json" }
      });

      if (!response.ok) {
        console.warn("Sitemap game list unavailable:", response.status);
        break;
      }

      const body = await response.json() as { data?: Json[] };
      const page = Array.isArray(body.data) ? body.data : [];
      gameRows.push(...page);

      if (page.length < GAME_PAGE_SIZE) break;
      offset += GAME_PAGE_SIZE;
    } catch (error) {
      console.warn("Sitemap game list request failed:", error);
      break;
    }
  }

  const origin = new URL(request.url).origin;
  const urls = [
    "<url><loc>" + escapeXml(origin + "/") + "</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>",
    "<url><loc>" + escapeXml(origin + "/rankings/weekly") + "</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>",
    "<url><loc>" + escapeXml(origin + "/rankings/monthly") + "</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>",
    "<url><loc>" + escapeXml(origin + "/rankings/yearly") + "</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>",
    "<url><loc>" + escapeXml(origin + "/community") + "</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>"
  ];

  for (const game of gameRows) {
    const id = String(game.id ?? "");
    if (!/^\d+$/.test(id)) continue;

    const loc = canonicalGameUrl(origin, id);
    const lastmod = Date.parse(String(game.updatedAt ?? ""));
    urls.push(
      "<url><loc>" + escapeXml(loc) + "</loc>" +
      (Number.isFinite(lastmod) ? "<lastmod>" + new Date(lastmod).toISOString() + "</lastmod>" : "") +
      "<changefreq>hourly</changefreq><priority>0.8</priority></url>"
    );
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.join("") +
    "</urlset>";

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=900, s-maxage=900"
    }
  });
}
async function renderAdminAnalyticsPage(request: Request, env: Env): Promise<Response> {
  const authorization = await authorizeAdminAnalytics(request, env);
  if (authorization instanceof Response) return authorization;

  const shell = await assetShell(env, request);
  if (!shell.ok) return shell;

  const output = await shell.text();
  const html = output.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>Bobaks Admin Analytics</title>"
  ).replace(
    /<main id="app" class="wrap"><\/main>/i,
    '<main id="app" class="wrap"><section class="admin-analytics-shell">' +
      '<div class="admin-analytics-header">' +
        '<div><div class="eyebrow">BOBAKS ADMIN</div><h1>Analytics Dashboard</h1>' +
        '<p>Private product usage analytics for authorized Bobaks administrators.</p></div>' +
        '<a class="btn" href="/">Back to Bobaks</a>' +
      '</div>' +
      '<div id="analyticsApp"></div>' +
    '</section></main>'
  ).replace(
    /<\/head>/i,
    '<meta name="robots" content="noindex, nofollow">' +
    '<meta name="referrer" content="no-referrer">' +
    '<link rel="stylesheet" href="/admin-analytics.css">' +
    '<script type="module" src="/admin-analytics.js"></script></head>'
  );

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
  );

  return new Response(html, { status: 200, headers });
}

async function handleAdminAnalyticsApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" }
    });
  }

  const authorization = await authorizeAdminAnalytics(request, env);
  if (authorization instanceof Response) return authorization;

  const parsedRange = parseAnalyticsRange(new URL(request.url));
  if (parsedRange instanceof Response) return parsedRange;

  try {
    const report = await fetchAdminAnalytics(
      parsedRange,
      env,
      fetch
    );

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    console.error("Admin analytics query failed:", error);
    return new Response("Analytics data is temporarily unavailable.", {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
}

async function handleAnalytics(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" }
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return new Response("Unsupported content type", { status: 415 });
  }

  const raw = await request.text();
  if (raw.length > 2048) return new Response("Payload too large", { status: 413 });

  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const event = String(body.event ?? "");
    if (!EVENTS.has(event)) return new Response("Invalid event", { status: 400 });

    recordAnalytics(env, event, {
      route: typeof body.route === "string" ? body.route.slice(0, 120) : "/",
      period: typeof body.period === "string" ? body.period : undefined,
      gameId: typeof body.gameId === "string" ? body.gameId : undefined,
      channel: typeof body.channel === "string" ? body.channel : undefined,
      visitorId: typeof body.visitorId === "string" ? body.visitorId : undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined
    });

    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
}

export async function handleFrontendRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/analytics") {
    return handleAnalytics(request, env);
  }

  if (url.pathname === "/admin/api/analytics") {
    return handleAdminAnalyticsApi(request, env);
  }

  if (request.method !== "GET") {
    return env.ASSETS.fetch(request);
  }

  if (url.pathname === "/robots.txt") {
    return new Response(
      "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nSitemap: " + url.origin + "/sitemap.xml\n",
      {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600, s-maxage=3600"
        }
      }
    );
  }

  if (url.pathname === "/sitemap.xml") {
    return renderSitemap(request, env, fetchImpl);
  }

  if (url.pathname === "/community") {
    return renderCommunityPage(request, env);
  }

  if (url.pathname === "/admin/analytics") {
    return renderAdminAnalyticsPage(request, env);
  }

  const rankingPeriod = rankingPeriodForPath(url.pathname);
  if (rankingPeriod) {
    return renderRankingPage(request, env, rankingPeriod, fetchImpl);
  }

  const gameMatch = url.pathname.match(/^\/game\/(\d+)$/);
  if (gameMatch) {
    return renderGamePage(request, env, gameMatch[1], fetchImpl);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFrontendRequest(request, env);
  }
};
