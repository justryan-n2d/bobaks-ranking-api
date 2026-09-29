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

    if (url.includes("/rest/v1/DailyGameStat?")) {
      return response([{
        id: "88",
        gameId: "1",
        date: "2026-01-15T00:00:00.000Z",
        averagePlayers: 80.5,
        peakPlayers: 140,
        lowestPlayers: 20,
        totalSamples: 120
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

test("deep health reports healthy production dependencies", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const now = Date.now();
  const recent = new Date(now - 5 * 60 * 1000).toISOString();
  const dailySummary = new Date(now - 60 * 60 * 1000).toISOString();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/rpc/get_rankings_audit")) {
      return response({
        methodologyVersion: "2026-09-28",
        auditStatus: "passed",
        historicalRecovery: {
          status: "passed",
          recoverableDailyRows: 0,
          rawDaysWithoutSummary: []
        },
        rankings: {
          live: { rows: 100, maxLatestSnapshotAgeSeconds: 300 },
          weekly: { rows: 100 },
          monthly: { rows: 100 },
          yearly: { rows: 100 }
        }
      });
    }

    if (url.includes("/rest/v1/DataCollectionLog?")) {
      const parsed = new URL(url);
      const status = parsed.searchParams.get("status");
      if (status === "in.(success,partial,failed)") {
        return response([{
          startedAt: recent,
          finishedAt: new Date(now - 4 * 60 * 1000).toISOString(),
          status: "success",
          gamesChecked: 123,
          gamesUpdated: 123,
          errors: 0
        }]);
      }

      if (status === "in.(daily_summary_success,daily_summary_failed)") {
        return response([{
          startedAt: dailySummary,
          finishedAt: new Date(now - 60 * 60 * 1000 + 30_000).toISOString(),
          status: "daily_summary_success",
          gamesUpdated: 158,
          errors: 0
        }]);
      }
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(
    new Request("https://api.example/api/health/deep"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "healthy");
  assert.equal(body.service, "bobaks-ranking-api");
  assert.equal(body.checks.database.status, "healthy");
  assert.equal(body.checks.collection.status, "healthy");
  assert.equal(body.checks.rankings.status, "healthy");
  assert.equal(body.checks.historicalRecovery.status, "healthy");
  assert.equal(body.checks.rankings.liveRows, 100);
  assert.equal(body.checks.historicalRecovery.recoverableDailyRows, 0);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(calls.filter(call => call.url.includes("/rest/v1/rpc/get_rankings_audit")).length, 1);
});

test("deep health becomes unhealthy when the last good collection is stale", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const dailySummary = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/rpc/get_rankings_audit")) {
      return response({
        methodologyVersion: "2026-09-28",
        auditStatus: "passed",
        historicalRecovery: {
          status: "passed",
          recoverableDailyRows: 0,
          rawDaysWithoutSummary: []
        },
        rankings: {
          live: { rows: 100, maxLatestSnapshotAgeSeconds: 960 },
          weekly: { rows: 100 },
          monthly: { rows: 100 },
          yearly: { rows: 100 }
        }
      });
    }

    if (url.includes("/rest/v1/DataCollectionLog?")) {
      const parsed = new URL(url);
      const status = parsed.searchParams.get("status");
      if (status === "in.(success,partial,failed)") {
        return response([{ startedAt: stale, status: "failed", gamesChecked: 0, gamesUpdated: 0, errors: 1 }]);
      }
      if (status === "in.(daily_summary_success,daily_summary_failed)") {
        return response([{ startedAt: dailySummary, status: "daily_summary_success", gamesUpdated: 158, errors: 0 }]);
      }
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(
    new Request("https://api.example/api/health/deep"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.status, "unhealthy");
  assert.equal(body.checks.collection.status, "unhealthy");
  assert.equal(body.checks.rankings.status, "unhealthy");
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
  const historyBody = await history.json() as {
    gameId: string;
    days: number;
    resolution: string;
    data: Array<{ resolution: string }>;
  };
  assert.equal(history.status, 200);
  assert.equal(historyBody.gameId, "1");
  assert.equal(historyBody.days, 30);
  assert.equal(historyBody.resolution, "snapshot");
  assert.equal(historyBody.data.length, 1);
  assert.equal(historyBody.data[0].resolution, "snapshot");

  const longHistory = await handleApi(
    new Request("https://api.example/api/games/1/history?days=365"),
    env,
    fetchImpl
  );
  const longHistoryBody = await longHistory.json() as {
    gameId: string;
    days: number;
    resolution: string;
    data: Array<{ resolution: string; playerCount: number }>;
  };
  assert.equal(longHistory.status, 200);
  assert.equal(longHistoryBody.gameId, "1");
  assert.equal(longHistoryBody.days, 365);
  assert.equal(longHistoryBody.resolution, "mixed");
  assert.equal(longHistoryBody.data.length, 2);
  assert.equal(longHistoryBody.data[0].resolution, "daily");
  assert.equal(longHistoryBody.data[0].playerCount, 80.5);
  assert.equal(longHistoryBody.data[1].resolution, "snapshot");
  assert.ok(calls.some(call => call.url.includes("/rest/v1/DailyGameStat?")));
  assert.ok(calls.some(call => call.url.includes("/rest/v1/DailyGameStat?")));
  assert.equal(calls.filter(call => call.url.includes("/rest/v1/DailyGameStat?")).every(call => !call.url.includes("date.lt=")), true);

  const peak = await handleApi(new Request("https://api.example/api/games/1/peak"), env, fetchImpl);
  assert.equal(peak.status, 200);
  assert.equal((await peak.json() as { data: { peakPlayers: number } }).data.peakPlayers, 500);

  const search = await handleApi(new Request("https://api.example/api/search?q=test"), env, fetchImpl);
  assert.equal(search.status, 200);
  assert.equal((await search.json() as { data: unknown[] }).data.length, 1);
  assert.ok(calls.some(call => call.url.includes("name=ilike")));
});


test("long history reports snapshot resolution when no daily summaries exist", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fallback = makeFetch(calls);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/DailyGameStat?")) {
      calls.push({ url, headers: new Headers(init?.headers) });
      return response([]);
    }
    return fallback(input, init);
  };

  const result = await handleApi(
    new Request("https://api.example/api/games/1/history?days=365"),
    env,
    fetchImpl
  );
  const body = await result.json() as {
    resolution: string;
    data: Array<{ resolution: string }>;
  };

  assert.equal(result.status, 200);
  assert.equal(body.resolution, "snapshot");
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].resolution, "snapshot");
});



test("long history paginates raw snapshots beyond the Supabase page limit", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fallback = makeFetch(calls);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/GameSnapshot?")) {
      const parsed = new URL(url);
      const offset = parsed.searchParams.get("offset");
      calls.push({ url, headers: new Headers(init?.headers) });

      if (offset === "0") {
        return response(Array.from({ length: 500 }, (_, i) => ({
          id: String(1000 + i),
          gameId: "1",
          playerCount: 100 + i,
          timestamp: "2026-09-27T01:15:00.000Z"
        })));
      }

      if (offset === "500") {
        return response([{
          id: "2000",
          gameId: "1",
          playerCount: 999,
          timestamp: "2026-09-27T02:15:00.000Z"
        }]);
      }

      return response([]);
    }

    return fallback(input, init);
  };

  const result = await handleApi(
    new Request("https://api.example/api/games/1/history?days=365"),
    env,
    fetchImpl
  );
  const body = await result.json() as {
    data: unknown[];
    resolution: string;
  };

  assert.equal(result.status, 200);
  assert.equal(body.resolution, "mixed");
  assert.equal(body.data.length, 502);

  const snapshotCalls = calls.filter(call => call.url.includes("/rest/v1/GameSnapshot?"));
  assert.equal(snapshotCalls.length, 2);
  assert.equal(new URL(snapshotCalls[0].url).searchParams.get("limit"), "500");
  assert.equal(new URL(snapshotCalls[0].url).searchParams.get("offset"), "0");
  assert.equal(new URL(snapshotCalls[1].url).searchParams.get("offset"), "500");
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

test("ranking rules endpoint exposes the canonical public methodology", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings/rules"), env, makeFetch(calls));
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.rulesVersion, "2026-09-28");
  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.title, "How Bobaks Rankings Work");
  assert.equal(body.topN, 100);
  assert.equal(body.collection.cadenceMinutes, 10);
  assert.equal(body.timezone, "UTC");
  assert.equal(body.eligibility.live.includes("15 minutes"), true);
  assert.equal(body.eligibility.weekly.minimumSamples, 12);
  assert.equal(body.eligibility.weekly.minimumCoverage, 0.5);
  assert.equal(body.eligibility.monthly.minimumSamples, 12);
  assert.equal(body.eligibility.monthly.minimumCoverage, 0.5);
  assert.equal(typeof body.score.live, "string");
  assert.equal(typeof body.score.yearly, "string");
  assert.deepEqual(body.collectionRuns.countedStatuses, ["success", "partial"]);
  assert.deepEqual(body.collectionRuns.excludedStatuses, [
    "failed",
    "daily_summary_success",
    "daily_summary_failed"
  ]);
  assert.match(body.ordering.tieBreak, /gameId/);
  assert.ok(Array.isArray(body.limitations));
  assert.equal(result.headers.get("cache-control"), "public, max-age=300");
  assert.equal(calls.length, 0);
});

test("ranking methodology endpoint returns the same canonical methodology", async () => {
  const rulesResult = await handleApi(
    new Request("https://api.example/api/rankings/rules"),
    env,
    makeFetch([])
  );
  const methodologyResult = await handleApi(
    new Request("https://api.example/api/rankings/methodology"),
    env,
    makeFetch([])
  );

  assert.equal(rulesResult.status, 200);
  assert.equal(methodologyResult.status, 200);
  assert.deepEqual(await methodologyResult.json(), await rulesResult.json());
  assert.equal(methodologyResult.headers.get("cache-control"), "public, max-age=300");
});

test("ranking audit endpoint returns server-side integrity metadata", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/rpc/get_rankings_audit")) {
      assert.equal(init?.method, "POST");
      assert.equal(headers.get("apikey"), "sb_secret_test");
      assert.equal(headers.get("authorization"), null);

      return response({
        methodologyVersion: "2026-09-28",
        auditStatus: "passed",
        historicalRecovery: {
          status: "passed",
          lookbackDays: 31,
          recoverableDailyRows: 0,
          rawDaysObserved: 6,
          dailySummaryDaysObserved: 6,
          rawDaysWithoutSummary: [],
          history: {
            oldestSnapshotAt: "2026-09-23T06:27:55.435Z",
            newestSnapshotAt: "2026-09-28T01:20:55.101Z"
          },
          collection: {
            expectedCadenceSeconds: 600,
            gapThresholdSeconds: 1200,
            successRuns: 90,
            partialRuns: 3,
            failedRuns: 7,
            gapsOverThreshold: 0,
            largestGapSeconds: 0,
            gaps: []
          },
          recoveryRule: "Only days with retained qualifying snapshots are repairable. Days with no qualifying snapshots are left without synthesized statistics."
        },
        collection: {
          cadenceSeconds: 600,
          latestStatus: "success",
          latestStartedAt: "2026-09-28T00:00:00.000Z"
        },
        rankings: {
          live: {
            rows: 100,
            calculatedAt: "2026-09-28T00:00:00.000Z",
            maxLatestSnapshotAgeSeconds: 3
          },
          weekly: {
            rows: 100,
            calculatedAt: "2026-09-28T00:00:00.000Z",
            collectionOpportunities: 324,
            minimumSamplesObserved: 164,
            minimumCoverageObserved: 0.506
          },
          monthly: {
            rows: 100,
            calculatedAt: "2026-09-28T00:00:00.000Z",
            collectionOpportunities: 324,
            minimumSamplesObserved: 164,
            minimumCoverageObserved: 0.506
          },
          yearly: {
            rows: 100,
            calculatedAt: "2026-09-28T00:00:00.000Z"
          }
        }
      });
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(
    new Request("https://api.example/api/rankings/audit"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.auditStatus, "passed");
  assert.equal(body.methodologyVersion, "2026-09-28");
  assert.equal(body.historicalRecovery.status, "passed");
  assert.equal(body.historicalRecovery.recoverableDailyRows, 0);
  assert.deepEqual(body.historicalRecovery.rawDaysWithoutSummary, []);
  assert.equal(body.rankings.live.rows, 100);
  assert.equal(body.rankings.live.maxLatestSnapshotAgeSeconds, 3);
  assert.equal(body.rankings.weekly.collectionOpportunities, 324);
  assert.equal(body.rankings.weekly.minimumSamplesObserved, 164);
  assert.equal(body.rankings.weekly.minimumCoverageObserved, 0.506);
  assert.equal(result.headers.get("cache-control"), "public, max-age=60, s-maxage=60");
  assert.equal(calls.length, 1);
});
