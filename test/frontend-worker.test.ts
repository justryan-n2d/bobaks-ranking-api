import assert from "node:assert/strict";
import test from "node:test";
import { handleFrontendRequest } from "../src/frontend-worker";

const shell = `<!doctype html>
<html><head>
<title>Bobaks Ranking | Live Rankings & Historical Trends</title>
<meta id="seo-description" name="description" content="home">
<link id="seo-canonical" rel="canonical" href="/">
<meta id="seo-og-title" property="og:title" content="home">
<meta id="seo-og-description" property="og:description" content="home">
<meta id="seo-og-url" property="og:url" content="/">
<meta id="seo-og-image" property="og:image" content="/logo.png">
<meta id="seo-twitter-title" name="twitter:title" content="home">
<meta id="seo-twitter-description" name="twitter:description" content="home">
<meta id="seo-twitter-image" name="twitter:image" content="/logo.png">
</head><body><main id="app" class="wrap"></main></body></html>`;

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" }
  });
}

function makeEnv(points: unknown[] = []) {
  return {
    API_ORIGIN: "https://api.example",
    ASSETS: {
      async fetch() {
        return new Response(shell, {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    },
    ANALYTICS: {
      writeDataPoint(point: unknown) {
        points.push(point);
      }
    }
  };
}

test("game routes return an indexable SEO page with canonical metadata and JSON-LD", async () => {
  const points: unknown[] = [];
  const env = makeEnv(points);

  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith("/api/games/42")) {
      return response({
        data: {
          id: 42,
          name: "Example Experience",
          creatorName: "Example Studio",
          description: "A useful game description.",
          iconUrl: "https://cdn.example/icon.png",
          currentPlayers: 1234,
          rankings: { live: { rank: 7, score: 1234 } },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z"
        }
      });
    }
    if (url.endsWith("/api/games/42/peak")) {
      return response({ data: { peakPlayers: 4321, peakAt: "2026-09-28T00:00:00.000Z" } });
    }
    throw new Error("Unexpected API request: " + url);
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/game/42"),
    env,
    fakeFetch
  );

  const html = await result.text();
  assert.equal(result.status, 200);
  assert.match(html, /<title>Example Experience \| Bobaks Ranking<\/title>/);
  assert.match(html, /rel="canonical" href="https://bobaks.example/game/42"/);
  assert.match(html, /property="og:title" content="Example Experience \| Bobaks Ranking"/);
  assert.match(html, /property="og:url" content="https://bobaks.example/game/42"/);
  assert.match(html, /Bobaks Live Rank: <strong>#7<\/strong>/);
  assert.match(html, /Recorded Peak: <strong>4321<\/strong>/);
  assert.match(html, /application/ld+json/);
  assert.match(html, /"@type":"VideoGame"/);
  assert.ok(points.length >= 1);
});

test("sitemap lists the homepage and active game URLs", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith("/api/games")) {
      return response({
        data: [
          { id: 42, updatedAt: "2026-09-29T00:00:00.000Z" },
          { id: 99, updatedAt: null }
        ]
      });
    }
    throw new Error("Unexpected API request: " + url);
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/sitemap.xml"),
    env,
    fakeFetch
  );
  const xml = await result.text();

  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.match(xml, /https://bobaks.example//);
  assert.match(xml, /https://bobaks.example/game/42/);
  assert.match(xml, /https://bobaks.example/game/99/);
  assert.match(xml, /<lastmod>2026-09-29T00:00:00.000Z<\/lastmod>/);
});

test("robots.txt exposes the sitemap and excludes API paths", async () => {
  const env = makeEnv([]);
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/robots.txt"),
    env
  );
  const body = await result.text();

  assert.equal(result.status, 200);
  assert.match(body, /Allow: //);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Sitemap: https://bobaks.example/sitemap.xml/);
});

test("analytics endpoint only accepts bounded allowlisted events", async () => {
  const points: unknown[] = [];
  const env = makeEnv(points);

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "watchlist_add",
        route: "/game/42",
        period: "live",
        gameId: "42",
        channel: "rank_card"
      })
    }),
    env
  );

  assert.equal(result.status, 204);
  assert.equal(points.length, 1);
  const point = points[0] as { blobs: string[]; doubles: number[]; indexes: string[] };
  assert.deepEqual(point.blobs, ["watchlist_add", "/game/:id", "live", "42", "rank_card"]);
  assert.deepEqual(point.doubles, [1]);
  assert.deepEqual(point.indexes, ["watchlist_add"]);

  const invalid = await handleFrontendRequest(
    new Request("https://bobaks.example/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "collect_ip_address" })
    }),
    env
  );
  assert.equal(invalid.status, 400);
});
