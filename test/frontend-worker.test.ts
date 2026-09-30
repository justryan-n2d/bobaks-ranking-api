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
  assert.ok(html.includes('rel="canonical" href="https://bobaks.example/game/42"'));
  assert.match(html, /property="og:title" content="Example Experience \| Bobaks Ranking"/);
  assert.ok(html.includes('property="og:url" content="https://bobaks.example/game/42"'));
  assert.match(html, /Bobaks Live Rank: <strong>#7<\/strong>/);
  assert.match(html, /Recorded Peak: <strong>4321<\/strong>/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"VideoGame"/);
});

test("game routes prefer the Cloudflare API service binding when available", async () => {
  const paths: string[] = [];
  const env = makeEnv([]) as ReturnType<typeof makeEnv> & {
    API: { fetch(request: Request): Promise<Response> };
  };

  env.API = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      paths.push(url.pathname);
      return response({
        data: {
          id: 42,
          name: "Service Binding Experience",
          creatorName: "Example Studio",
          description: "Served through the Cloudflare service binding.",
          iconUrl: "https://cdn.example/icon.png",
          currentPlayers: 321,
          rankings: { live: { rank: 9, score: 321 } },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z"
        }
      });
    }
  };

  const shouldNotCallPublicApi: typeof fetch = async () => {
    throw new Error("public API fetch should not be used when service binding is available");
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/game/42"),
    env,
    shouldNotCallPublicApi
  );

  assert.equal(result.status, 200);
  assert.match(await result.text(), /Service Binding Experience/);
  assert.deepEqual(paths.sort(), ["/api/games/42", "/api/games/42/peak"]);
});

test("sitemap prefers the Cloudflare API service binding when available", async () => {
  const env = makeEnv([]) as ReturnType<typeof makeEnv> & {
    API: { fetch(request: Request): Promise<Response> };
  };
  let requestCount = 0;

  env.API = {
    async fetch(request: Request) {
      requestCount += 1;
      const url = new URL(request.url);
      assert.equal(url.pathname, "/api/games");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.get("offset"), "0");
      return response({ data: [{ id: 42, updatedAt: "2026-09-30T00:00:00.000Z" }] });
    }
  };

  const shouldNotCallPublicApi: typeof fetch = async () => {
    throw new Error("public API fetch should not be used when service binding is available");
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/sitemap.xml"),
    env,
    shouldNotCallPublicApi
  );
  const xml = await result.text();

  assert.equal(result.status, 200);
  assert.equal(requestCount, 1);
  assert.ok(xml.includes("https://bobaks.example/game/42"));
});

test("sitemap lists the homepage and active game URLs", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (new URL(url).pathname === "/api/games") {
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
  assert.ok(xml.includes("https://bobaks.example/"));
  assert.ok(xml.includes("https://bobaks.example/game/42"));
  assert.ok(xml.includes("https://bobaks.example/game/99"));
  assert.ok(xml.includes("<lastmod>2026-09-29T00:00:00.000Z</lastmod>"));
});


test("sitemap paginates the active game catalog beyond the first 100 games", async () => {
  const env = makeEnv([]);
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    updatedAt: "2026-09-29T00:00:00.000Z"
  }));
  const secondPage = [{ id: 101, updatedAt: "2026-09-30T00:00:00.000Z" }];

  const fakeFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.origin === "https://api.example" && url.pathname === "/api/games") {
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      if (limit === "100" && offset === "0") return response({ data: firstPage });
      if (limit === "100" && offset === "100") return response({ data: secondPage });
      if (limit === null && offset === null) return response({ data: firstPage });
    }
    throw new Error("Unexpected API request: " + url.toString());
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/sitemap.xml"),
    env,
    fakeFetch
  );
  const xml = await result.text();

  assert.equal(result.status, 200);
  assert.ok(xml.includes("https://bobaks.example/game/100"));
  assert.ok(xml.includes("https://bobaks.example/game/101"));
  assert.ok(xml.includes("<lastmod>2026-09-30T00:00:00.000Z</lastmod>"));
});

test("ranking period routes return indexable landing pages", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith("/api/rankings?period=week")) {
      return response({
        data: [
          {
            gameId: "42",
            rank: 1,
            score: 12345,
            game: { name: "Example Experience", creatorName: "Example Studio" }
          },
          {
            gameId: "99",
            rank: 2,
            score: 9876,
            game: { name: "Second Experience", creatorName: "Second Studio" }
          }
        ]
      });
    }
    throw new Error("Unexpected API request: " + url);
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/rankings/weekly"),
    env,
    fakeFetch
  );
  const html = await result.text();

  assert.equal(result.status, 200);
  assert.ok(html.includes("<title>This Week&#39;s Roblox Game Rankings | Bobaks Ranking</title>"));
  assert.ok(html.includes('rel="canonical" href="https://bobaks.example/rankings/weekly"'));
  assert.ok(html.includes("Example Experience"));
  assert.ok(html.includes("/game/42"));
  assert.ok(html.includes('"@type":"ItemList"'));
  assert.match(result.headers.get("cache-control") || "", /max-age=60/);
});

test("sitemap includes crawlable ranking period URLs", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (new URL(url).pathname === "/api/games") {
      return response({ data: [] });
    }
    throw new Error("Unexpected API request: " + url);
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/sitemap.xml"),
    env,
    fakeFetch
  );
  const xml = await result.text();

  assert.ok(xml.includes("https://bobaks.example/rankings/weekly"));
  assert.ok(xml.includes("https://bobaks.example/rankings/monthly"));
  assert.ok(xml.includes("https://bobaks.example/rankings/yearly"));
});

test("robots.txt exposes the sitemap and excludes API paths", async () => {
  const env = makeEnv([]);
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/robots.txt"),
    env
  );
  const body = await result.text();

  assert.equal(result.status, 200);
  assert.ok(body.includes("Allow: /"));
  assert.ok(body.includes("Disallow: /api/"));
  assert.ok(body.includes("Disallow: /admin/"));
  assert.ok(body.includes("Sitemap: https://bobaks.example/sitemap.xml"));
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
        channel: "rank_card",
        visitorId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sessionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      })
    }),
    env
  );

  assert.equal(result.status, 204);
  assert.equal(points.length, 1);
  const point = points[0] as { blobs: string[]; doubles: number[]; indexes: string[] };
  assert.deepEqual(point.blobs, [
    "watchlist_add",
    "/game/:id",
    "live",
    "42",
    "rank_card",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  ]);
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




test("analytics endpoint drops malformed visitor and session identifiers", async () => {
  const points: unknown[] = [];
  const env = makeEnv(points);

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "page_view",
        route: "/",
        visitorId: "not-a-valid-id",
        sessionId: "also-invalid"
      })
    }),
    env
  );

  assert.equal(result.status, 204);
  assert.equal(points.length, 1);
  const point = points[0] as { blobs: string[]; indexes: string[] };
  assert.equal(point.blobs[5], "");
  assert.equal(point.blobs[6], "");
  assert.deepEqual(point.indexes, ["page_view"]);
});


test("community route returns an indexable hub with configurable Discord and public contact paths", async () => {
  const env = { ...makeEnv([]), DISCORD_INVITE_URL: "https://discord.gg/example" };
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/community"),
    env
  );
  const html = await result.text();

  assert.equal(result.status, 200);
  assert.match(html, /<title>Bobaks Ranking Community/);
  assert.ok(html.includes('rel="canonical" href="https://bobaks.example/community"'));
  assert.ok(html.includes("Discord community"));
  assert.ok(html.includes("Feature requests"));
  assert.ok(html.includes("Bug reports"));
  assert.ok(html.includes("Community polls"));
  assert.ok(html.includes("Game discovery"));
  assert.ok(html.includes("https://discord.gg/example"));
  assert.ok(html.includes("bobaksranking@gmail.com"));
  assert.match(result.headers.get("cache-control") || "", /max-age=300/);
});

test("community route shows a safe unconfigured Discord state instead of inventing an invite", async () => {
  const env = { ...makeEnv([]), DISCORD_INVITE_URL: "" };
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/community"),
    env
  );
  const html = await result.text();

  assert.equal(result.status, 200);
  assert.ok(html.includes("Discord link is not configured yet."));
  assert.ok(html.includes("mailto:bobaksranking@gmail.com"));
  assert.ok(!html.includes("discord.gg/example"));
});

test("sitemap includes the public community hub", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (new URL(url).pathname === "/api/games") return response({ data: [] });
    throw new Error("Unexpected API request: " + url);
  };
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/sitemap.xml"),
    env,
    fakeFetch
  );
  const xml = await result.text();
  assert.equal(result.status, 200);
  assert.ok(xml.includes("https://bobaks.example/community"));
});


test("sitemap stays crawlable when the game-list API has a temporary server error", async () => {
  const env = makeEnv([]);
  const fakeFetch: typeof fetch = async input => {
    const url = String(input);
    if (new URL(url).pathname === "/api/games") {
      return response({ error: "Database unavailable" }, 503);
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
  assert.ok(xml.includes("https://bobaks.example/"));
  assert.ok(xml.includes("https://bobaks.example/rankings/weekly"));
  assert.ok(xml.includes("https://bobaks.example/rankings/monthly"));
  assert.ok(xml.includes("https://bobaks.example/rankings/yearly"));
  assert.ok(xml.includes("https://bobaks.example/community"));
});


test("private admin analytics page fails closed when Access configuration is missing", async () => {
  const env = makeEnv([]);
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/admin/analytics"),
    env
  );
  assert.equal(result.status, 503);
  assert.match(await result.text(), /Private analytics access is not configured/);
});

test("private admin analytics API fails closed without a Cloudflare Access assertion", async () => {
  const env = {
    ...makeEnv([]),
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-audience"
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/admin/api/analytics?start=2026-09-30T00:00:00.000Z&end=2026-09-30T01:00:00.000Z"),
    env
  );

  assert.equal(result.status, 401);
  assert.match(await result.text(), /Authentication required/);
});

test("frontend worker proxies same-origin API requests through the API service binding", async () => {
  const env = makeEnv() as ReturnType<typeof makeEnv> & {
    API: { fetch(request: Request): Promise<Response> };
  };
  const calls: string[] = [];
  const paths: string[] = [];
  env.API = {
    async fetch(request: Request) {
      calls.push(request.url);
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };

  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/api/rankings?period=live"),
    env
  );

  assert.equal(result.status, 200);
  assert.equal(await result.text(), '{"ok":true}');
  assert.deepEqual(calls, ["https://api.example/api/rankings?period=live"]);
});

test("frontend worker gives cacheable static assets a long edge cache window", async () => {
  const env = makeEnv();
  const result = await handleFrontendRequest(
    new Request("https://bobaks.example/app.js"),
    env
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "public, max-age=300, s-maxage=86400");
});
