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
  if (pathname === "/" || pathname === "/saved" || pathname === "/compare") return pathname;
  if (/^\/game\/\d+$/.test(pathname)) return "/game/:id";
  return pathname.startsWith("/info") ? "/info" : "/other";
}

function recordAnalytics(env: Env, event: string, data: {
  route?: string;
  period?: string;
  gameId?: string;
  channel?: string;
}): void {
  if (!env.ANALYTICS || !EVENTS.has(event)) return;

  try {
    const period = PERIODS.has(data.period ?? "") ? String(data.period) : "";
    const gameId = data.gameId && /^\d{1,20}$/.test(data.gameId) ? data.gameId : "";
    const channel = data.channel ? String(data.channel).slice(0, 32) : "";

    env.ANALYTICS.writeDataPoint({
      blobs: [event, normalizeRoute(String(data.route ?? "/")), period, gameId, channel],
      doubles: [1],
      indexes: [event]
    });
  } catch (error) {
    console.warn("Product analytics write failed:", error);
  }
}

async function assetShell(env: Env, request: Request): Promise<Response> {
  return env.ASSETS.fetch(
    new Request(new URL("/index.html", request.url).toString(), request)
  );
}

function replaceTagById(html: string, id: string, tag: string): string {
  const pattern = new RegExp(
    "<(?:meta|link)[^>]*\\bid=[\\"']" + id + "[\\"'][^>]*>",
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
  const liveRanking = game.rankings?.live && typeof game.rankings.live === "object"
    ? game.rankings.live as Json
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

async function renderSitemap(
  request: Request,
  env: Env,
  fetchImpl: FetchLike
): Promise<Response> {
  const base = env.API_ORIGIN.replace(/\/$/, "");
  const response = await fetchImpl(base + "/api/games", {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    return new Response("Sitemap unavailable", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const body = await response.json() as { data?: Json[] };
  const origin = new URL(request.url).origin;
  const urls = [
    "<url><loc>" + escapeXml(origin + "/") + "</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>"
  ];

  for (const game of body.data ?? []) {
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
      channel: typeof body.channel === "string" ? body.channel : undefined
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

  if (request.method !== "GET") {
    return env.ASSETS.fetch(request);
  }

  if (url.pathname === "/robots.txt") {
    return new Response(
      "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: " + url.origin + "/sitemap.xml\n",
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

  const gameMatch = url.pathname.match(/^\/game\/(\d+)$/);
  if (gameMatch) {
    return renderGamePage(request, env, gameMatch[1], fetchImpl);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handleFrontendRequest(request, env);

    if (request.method === "GET" && response.ok) {
      const url = new URL(request.url);
      if (url.pathname !== "/sitemap.xml" && url.pathname !== "/robots.txt") {
        const gameMatch = url.pathname.match(/^\/game\/(\d+)$/);
        recordAnalytics(env, "page_view", {
          route: url.pathname,
          gameId: gameMatch?.[1]
        });
      }
    }

    return response;
  }
};
