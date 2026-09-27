import test from "node:test";
import assert from "node:assert/strict";
import apiWorker, { handleApi } from "../src/api-worker";

const env = {
  SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test"
};

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function makeFetch(calls: { url: string; headers: Headers }[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/Game?")) {
      const parsed = new URL(url);
      if (parsed.searchParams.get("select") === "id" && parsed.searchParams.get("limit") === "1") {
        return response([{ id: "1" }]);
      }
      if (parsed.searchParams.get("id") === "eq.1") {
        return response([{
          id: "1",
          universeId: "1001",
          placeId: "2001",
          name: "Test Game",
          creatorName: "Creator",
          creatorId: "3001",
          iconUrl: "https://cdn.example/test.png",
          description: "Example",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-09-27T00:00:00.000Z",
          isActive: true
        }]);
      }
      if (parsed.searchParams.has("name")) {
        return response([{
          id: "1",
          universeId: "1001",
          placeId: "2001",
          name: "Test Game",
          creatorName: "Creator",
          iconUrl: "https://cdn.example/test.png"
        }]);
      }
      if (parsed.searchParams.has("id") && parsed.searchParams.get("id")?.startsWith("in.")) {
        return response([{
          id: "1",
          universeId: "1001",
          placeId: "2001",
          name: "Test Game",
          creatorName: "Creator",
          iconUrl: "https://cdn.example/test.png",
          isActive: true
        }]);
      }
      return response([{
        id: "1",
        universeId: "1001",
        placeId: "2001",
        name: "Test Game",
        creatorName: "Creator",
        iconUrl: "https://cdn.example/test.png",
        isActive: true
      }]);
    }

    if (url.includes("/rest/v1/DataCollectionLog?")) {
      return response([{
        startedAt: new Date(Date.now() - 600_000).toISOString()
      }]);
    }

    if (url.includes("/rest/v1/Ranking?")) {
      return response([{
        id: "10",
        gameId: "1",
        period: "weekly",
        rank: 1,
        score: 123.5,
        calculatedAt: "2026-09-27T01:20:00.000Z"
      }]);
    }

    if (url.includes("/rest/v1/GameSnapshot?")) {
      return response([{
        id: "99",
        gameId: "1",
        playerCount: 123,
        timestamp: "2026-09-27T01:15:00.000Z"
      }]);
    }

    if (url.includes("/rest/v1/GamePeak?")) {
      return response([{
        id: "7",
        gameId: "1",
        peakPlayers: 500,
        peakAt: "2026-09-26T12:00:00.000Z"
      }]);
    }

    throw new Error(`Unhandled URL: ${url}`);
  };
}


test("ranking methodology endpoint exposes the canonical rules without database access", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings/methodology"), env, makeFetch(calls));
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.title, "How Bobaks Rankings Work");
  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.collection.cadenceMinutes, 10);
  assert.equal(body.rules.live.freshnessMinutes, 15);
  assert.equal(body.rules.weekly.minimumSamples, 12);
  assert.equal(body.rules.weekly.minimumCoverage, 0.5);
  assert.equal(body.rules.monthly.minimumSamples, 12);
  assert.equal(body.rules.monthly.minimumCoverage, 0.5);
  assert.equal(body.rules.yearly.period.includes("previous 364 days"), true);
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(calls.length, 0);
});

test("ranking audit endpoint returns server-side integrity and current audit metadata", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/rpc/get_rankings_audit")) {
      assert.equal(init?.method, "POST");
      assert.equal(headers.get("apikey"), "sb_secret_test");
      return response({
        methodologyVersion: "2026-09-28",
        auditStatus: "passed",
        rankings: {
          live: { rows: 100, calculatedAt: "2026-09-28T00:00:00.000Z", maxLatestSnapshotAgeSeconds: 9 },
          weekly: { rows: 100, calculatedAt: "2026-09-28T00:00:00.000Z", collectionOpportunities: 144, minimumSamplesObserved: 71, minimumCoverageObserved: 0.493 }
        }
      });
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(new Request("https://api.example/api/rankings/audit"), env, fetchImpl);
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.auditStatus, "passed");
  assert.equal(body.rankings.live.rows, 100);
  assert.equal(body.rankings.live.maxLatestSnapshotAgeSeconds, 9);
  assert.equal(body.rankings.weekly.collectionOpportunities, 144);
  assert.equal(result.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(calls.length, 1);
});

test("health checks Supabase and returns connected", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/health"), env, makeFetch(calls));

  assert.equal(result.status, 200);
  const body = await result.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.service, "bobaks-ranking-api");
  assert.equal(body.database, "connected");
  assert.equal(typeof body.timestamp, "string");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get("apikey"), "sb_secret_test");
  assert.equal(calls[0].headers.get("authorization"), null);
});

test("ranking rules endpoint is a backward-compatible methodology alias", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings/rules"), env, makeFetch(calls));

  assert.equal(result.status, 200);
  const body = await result.json() as Record<string, any>;
  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.rules.common.topN, 100);
  assert.equal(body.rules.live.freshnessMinutes, 15);
  assert.equal(body.rules.weekly.minimumSamples, 12);
  assert.equal(body.rules.weekly.minimumCoverage, 0.5);
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(calls.length, 0);
});

test("ranking endpoint supports the current period query contract", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings?period=week"), env, makeFetch(calls));

  const body = await result.json() as Record<string, unknown>;
  assert.equal(result.status, 200);
  assert.equal(body.period, "week");
  assert.equal(body.refreshIntervalSeconds, 600);
  assert.equal(typeof body.nextCollectionAt, "string");
  assert.equal(body.nextRefreshAt, body.nextCollectionAt);
  const nextCollectionAt = Date.parse(String(body.nextCollectionAt));
  assert.ok(nextCollectionAt >= Date.now() + 10_000);
  assert.ok(nextCollectionAt <= Date.now() + 25_000);
  assert.equal(result.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(calls.length, 3);
  assert.ok(calls.some(call => call.url.includes("/rest/v1/DataCollectionLog?")));
  assert.equal((body.data as unknown[]).length, 1);
  assert.match(calls[0].url, /period=eq\.weekly/);
  assert.equal(new URL(calls[1].url).searchParams.get("id"), "in.(1)");
});

test("legacy ranking paths remain compatible", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings/monthly"), env, makeFetch(calls));
  const body = await result.json() as Record<string, unknown>;

  assert.equal(result.status, 200);
  assert.equal(body.period, "month");
  assert.match(calls[0].url, /period=eq\.monthly/);
});

test("game, history, peak, and search endpoints return data", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = makeFetch(calls);

  const game = await handleApi(new Request("https://api.example/api/games/1"), env, fetchImpl);
  assert.equal(game.status, 200);
  assert.equal((await game.json() as { data: { name: string } }).data.name, "Test Game");

  const history = await handleApi(new Request("https://api.example/api/games/1/history?days=30"), env, fetchImpl);
  const historyBody = await history.json() as { gameId: string; days: number; data: unknown[] };
  assert.equal(history.status, 200);
  assert.equal(historyBody.gameId, "1");
  assert.equal(historyBody.days, 30);
  assert.equal(historyBody.data.length, 1);

  const peak = await handleApi(new Request("https://api.example/api/games/1/peak"), env, fetchImpl);
  assert.equal(peak.status, 200);
  assert.equal((await peak.json() as { data: { peakPlayers: number } }).data.peakPlayers, 500);

  const search = await handleApi(new Request("https://api.example/api/search?q=test"), env, fetchImpl);
  assert.equal(search.status, 200);
  assert.equal((await search.json() as { data: unknown[] }).data.length, 1);
  assert.ok(calls.some(call => call.url.includes("name=ilike")));
});

test("invalid inputs are rejected before database access", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = makeFetch(calls);

  const history = await handleApi(new Request("https://api.example/api/games/1/history?days=0"), env, fetchImpl);
  assert.equal(history.status, 400);

  const search = await handleApi(new Request("https://api.example/api/search"), env, fetchImpl);
  assert.equal(search.status, 400);

  const invalidPeriod = await handleApi(new Request("https://api.example/api/rankings?period=bad"), env, fetchImpl);
  assert.equal(invalidPeriod.status, 400);

  const unknownGameId = await handleApi(new Request("https://api.example/api/games/not-an-id"), env, fetchImpl);
  assert.equal(unknownGameId.status, 404);

  assert.equal(calls.length, 0);
});

test("public worker adds CORS headers and rejects unsupported methods", async () => {
  const cors = await apiWorker.fetch(new Request("https://api.example/api/health", { method: "OPTIONS" }), env);
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get("access-control-allow-origin"), "*");

  const method = await apiWorker.fetch(new Request("https://api.example/api/health", { method: "POST" }), env);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("access-control-allow-origin"), "*");
});


test("ranking rules endpoint is a backward-compatible methodology alias", async () => {
  const result = await handleApi(new Request("https://api.example/api/rankings/rules"), env, makeFetch([]));

  assert.equal(result.status, 200);
  const body = await result.json() as {
    methodologyVersion: string;
    rules: { common: { topN: number }; live: { freshnessMinutes: number } };
  };

  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.rules.common.topN, 100);
  assert.equal(body.rules.live.freshnessMinutes, 15);
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
});

test("ranking methodology endpoint returns the published contract", async () => {
  const result = await handleApi(new Request("https://api.example/api/rankings/methodology"), env, makeFetch([]));

  assert.equal(result.status, 200);
  const body = await result.json() as {
    methodologyVersion: string;
    collection: { cadenceMinutes: number };
    rules: {
      common: { topN: number; activeGamesOnly: boolean };
      live: { freshnessMinutes: number };
      weekly: { minimumSamples: number; minimumCoverage: number };
      monthly: { minimumSamples: number; minimumCoverage: number };
      yearly: { period: string };
    };
  };

  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.collection.cadenceMinutes, 10);
  assert.equal(body.rules.common.topN, 100);
  assert.equal(body.rules.common.activeGamesOnly, true);
  assert.equal(body.rules.live.freshnessMinutes, 15);
  assert.equal(body.rules.weekly.minimumSamples, 12);
  assert.equal(body.rules.weekly.minimumCoverage, 0.5);
  assert.equal(body.rules.monthly.minimumSamples, 12);
  assert.equal(body.rules.monthly.minimumCoverage, 0.5);
  assert.match(body.rules.yearly.period, /365/);
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
});

test("ranking audit endpoint returns live audit metadata", async () => {
  const result = await handleApi(new Request("https://api.example/api/rankings/audit"), env, makeFetch([]));

  assert.equal(result.status, 200);
  const body = await result.json() as {
    methodologyVersion: string;
    auditStatus: string;
    rankings: { live: { rows: number } };
  };

  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.auditStatus, "passed");
  assert.equal(body.rankings.live.rows, 100);
  assert.equal(result.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
});
