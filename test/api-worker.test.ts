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

    if (url.includes("/rest/v1/rpc/get_game_current_stats")) {
      return response([{
        playerCount: 123,
        snapshotAt: "2026-09-27T01:15:00.000Z"
      }]);
    }

    if (url.includes("/rest/v1/rpc/get_game_rank_history")) {
      return response([{
        date: "2026-09-26",
        rank: 2,
        averagePlayers: 120,
        gamesRanked: 100
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



test("GET /api/games supports bounded pagination while keeping the 100-row default", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");

    if (parsed.pathname === "/rest/v1/Game") {
      const limit = parsed.searchParams.get("limit");
      const offset = parsed.searchParams.get("offset");
      if (limit === "2" && offset === "100") {
        return response([
          { id: "101", name: "Game 101", isActive: true },
          { id: "102", name: "Game 102", isActive: true }
        ]);
      }
      if (limit === "100" && offset === "0") {
        return response([]);
      }
      return response([]);
    }

    throw new Error("Unhandled URL: " + url);
  };

  const paged = await handleApi(
    new Request("https://api.example/api/games?limit=2&offset=100"),
    env,
    fetchImpl
  );
  assert.equal(paged.status, 200);
  assert.deepEqual((await paged.json()).data.map((row: { id: string }) => row.id), ["101", "102"]);
  assert.match(calls[0], /[?&]limit=2(&|$)/);
  assert.match(calls[0], /[?&]offset=100(&|$)/);

  const defaultPage = await handleApi(
    new Request("https://api.example/api/games"),
    env,
    fetchImpl
  );
  assert.equal(defaultPage.status, 200);
  assert.match(calls[1], /[?&]limit=100(&|$)/);
  assert.match(calls[1], /[?&]offset=0(&|$)/);

  const invalidLimit = await handleApi(
    new Request("https://api.example/api/games?limit=101"),
    env,
    fetchImpl
  );
  assert.equal(invalidLimit.status, 400);

  const invalidOffset = await handleApi(
    new Request("https://api.example/api/games?offset=-1"),
    env,
    fetchImpl
  );
  assert.equal(invalidOffset.status, 400);
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

      if (status === "in.(success,partial)") {
        return response([{
          startedAt: recent,
          finishedAt: new Date(now - 4 * 60 * 1000).toISOString(),
          status: "success",
          gamesChecked: 123,
          gamesUpdated: 123,
          errors: 0
        }]);
      }

      if (status === "eq.failed" || parsed.searchParams.get("rankingRefreshStatus") === "eq.failed") {
        return response([]);
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
      if (status === "in.(success,partial)") {
        return response([]);
      }

      if (status === "eq.failed" || parsed.searchParams.get("rankingRefreshStatus") === "eq.failed") {
        return response([]);
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

test("deep health surfaces recent collection and ranking refresh failures", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const now = Date.now();
  const recent = new Date(now - 8 * 60 * 1000).toISOString();

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
          collectionRunId: "11111111-1111-1111-1111-111111111111",
          startedAt: recent,
          finishedAt: recent,
          status: "success",
          gamesChecked: 123,
          gamesUpdated: 123,
          errors: 0,
          rankingRefreshStatus: "success",
          rankingRefreshStartedAt: recent,
          rankingRefreshFinishedAt: recent
        }]);
      }

      if (status === "in.(success,partial)") {
        return response([{
          startedAt: recent,
          finishedAt: recent,
          status: "success",
          gamesChecked: 123,
          gamesUpdated: 123,
          errors: 0
        }]);
      }

      if (status === "eq.failed") {
        return response([{
          collectionRunId: "22222222-2222-2222-2222-222222222222",
          startedAt: recent,
          finishedAt: recent,
          status: "failed",
          gamesChecked: 0,
          gamesUpdated: 0,
          errors: 1,
          errorMessage: "Roblox HTTP 429"
        }]);
      }

      if (parsed.searchParams.get("rankingRefreshStatus") === "eq.failed") {
        return response([{
          collectionRunId: "33333333-3333-3333-3333-333333333333",
          startedAt: recent,
          rankingRefreshStartedAt: recent,
          rankingRefreshFinishedAt: recent,
          rankingRefreshStatus: "failed",
          rankingRefreshErrorMessage: "refresh failed"
        }]);
      }

      if (status === "in.(daily_summary_success,daily_summary_failed)") {
        return response([{
          startedAt: recent,
          finishedAt: recent,
          status: "daily_summary_success",
          gamesUpdated: 123,
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
  assert.equal(body.alerts.active, true);
  assert.equal(body.alerts.severity, "critical");
  assert.equal(body.alerts.recentCollectionFailureCount, 1);
  assert.equal(body.alerts.recentRankingRefreshFailureCount, 1);
  assert.equal(body.checks.rankings.status, "healthy");
  assert.equal(body.checks.rankingRefresh.status, "healthy");
  assert.equal(body.checks.rankingRefresh.latestStatus, "success");
  assert.equal(body.alerts.reasons.length, 2);
  assert.match(body.alerts.reasons[0], /collection run failed/i);
  assert.match(body.alerts.reasons[1], /ranking refresh failed/i);
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
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("cloudflare-cdn-cache-control"), "public, max-age=5, stale-while-revalidate=30, stale-if-error=60");
  assert.equal(calls.length, 3);
  assert.ok(calls.some(call => call.url.includes("/rest/v1/DataCollectionLog?")));
  assert.equal((body.data as unknown[]).length, 1);
  assert.ok(calls.some(call => /period=eq\.weekly/.test(call.url)));
  assert.ok(calls.some(call => /id=in\.\(/.test(call.url)));
});

test("social feed returns ranking, trending, and peak posts from existing Bobaks data", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/Ranking?")) {
      return response([
        {
          id: "10",
          gameId: "1",
          period: "weekly",
          rank: 1,
          score: 12345,
          previousRank: 4,
          calculatedAt: "2026-09-29T01:20:00.000Z"
        },
        {
          id: "11",
          gameId: "2",
          period: "weekly",
          rank: 2,
          score: 10000,
          previousRank: 3,
          calculatedAt: "2026-09-29T01:20:00.000Z"
        },
        {
          id: "12",
          gameId: "3",
          period: "weekly",
          rank: 3,
          score: 9000,
          previousRank: 3,
          calculatedAt: "2026-09-29T01:20:00.000Z"
        }
      ]);
    }

    if (url.includes("/rest/v1/Game?")) {
      const parsed = new URL(url);
      const ids = (parsed.searchParams.get("id") ?? "").match(/\d+/g) ?? [];
      return response(ids.map(id => ({
        id,
        name: "Game " + id,
        creatorName: "Creator " + id,
        iconUrl: "https://cdn.example/" + id + ".png"
      })));
    }

    if (url.includes("/rest/v1/GamePeak?")) {
      return response([
        { id: "91", gameId: "3", peakPlayers: 50000, peakAt: "2026-09-28T12:00:00.000Z" },
        { id: "92", gameId: "1", peakPlayers: 40000, peakAt: "2026-09-27T12:00:00.000Z" }
      ]);
    }

    throw new Error("Unhandled URL: " + url);
  };

  const result = await handleApi(
    new Request("https://api.example/api/social/feed?period=week"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.period, "week");
  assert.equal(body.ranking.items.length, 3);
  assert.equal(body.ranking.items[0].name, "Game 1");
  assert.equal(body.trending.items[0].gameId, "1");
  assert.equal(body.trending.items[0].rankChange, 3);
  assert.equal(body.trending.items[1].gameId, "2");
  assert.equal(body.peaks.items[0].gameId, "3");
  assert.equal(body.peaks.items[0].peakPlayers, 50000);
  assert.equal(body.peaks.recentItems[0].gameId, "3");
  assert.equal(body.peaks.recentItems[0].peakAt, "2026-09-28T12:00:00.000Z");
  assert.match(body.posts.ranking.text, /Top 10 Roblox games this week/);
  assert.match(body.posts.trending.text, /Trending Roblox games this week/);
  assert.match(body.posts.peaks.text, /Highest recorded Roblox peaks/);
  assert.match(body.posts.ranking.text, /https:\/\/api\.example\/rankings\/weekly/);
  assert.equal(result.headers.get("cache-control"), "public, max-age=60, s-maxage=300");
  assert.equal(calls.filter(call => call.url.includes("/rest/v1/Ranking?")).length, 1);
  assert.equal(calls.filter(call => call.url.includes("/rest/v1/GamePeak?")).length, 2);
});

test("social feed rejects invalid periods before database access", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    calls.push(String(input));
    throw new Error("database should not be called");
  };

  const result = await handleApi(
    new Request("https://api.example/api/social/feed?period=invalid"),
    env,
    fetchImpl
  );

  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
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

  const rankHistory = await handleApi(new Request("https://api.example/api/games/1/rank-history?days=31"), env, fetchImpl);
  const rankHistoryBody = await rankHistory.json() as {
    gameId: string;
    days: number;
    data: Array<{ rank: number; averagePlayers: number }>;
  };
  assert.equal(rankHistory.status, 200);
  assert.equal(rankHistoryBody.gameId, "1");
  assert.equal(rankHistoryBody.days, 31);
  assert.equal(rankHistoryBody.data[0].rank, 2);
  assert.equal(rankHistoryBody.data[0].averagePlayers, 120);

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


test("operational observability summarizes recent collection and ranking-refresh telemetry", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const recent = "2026-09-29T10:00:00.000Z";
  const logs = [
    {
      collectionRunId: "11111111-1111-1111-1111-111111111111",
      startedAt: recent,
      finishedAt: "2026-09-29T10:02:00.000Z",
      status: "success",
      gamesChecked: 100,
      gamesUpdated: 80,
      errors: 0,
      rankingRefreshStatus: "success",
      rankingRefreshStartedAt: "2026-09-29T10:02:00.000Z",
      rankingRefreshFinishedAt: "2026-09-29T10:02:30.000Z"
    },
    {
      collectionRunId: "22222222-2222-2222-2222-222222222222",
      startedAt: "2026-09-29T09:50:00.000Z",
      finishedAt: "2026-09-29T09:53:00.000Z",
      status: "partial",
      gamesChecked: 100,
      gamesUpdated: 70,
      errors: 2,
      rankingRefreshStatus: "success",
      rankingRefreshStartedAt: "2026-09-29T09:53:00.000Z",
      rankingRefreshFinishedAt: "2026-09-29T09:54:00.000Z"
    },
    {
      collectionRunId: "33333333-3333-3333-3333-333333333333",
      startedAt: "2026-09-29T08:00:00.000Z",
      finishedAt: "2026-09-29T08:01:00.000Z",
      status: "failed",
      gamesChecked: 0,
      gamesUpdated: 0,
      errors: 3,
      errorMessage: "Roblox HTTP 429"
    }
  ];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });

    if (url.includes("/rest/v1/DataCollectionLog?")) {
      return response(logs);
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(
    new Request("https://api.example/api/observability?hours=24"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.windowHours, 24);
  assert.equal(body.runs.total, 3);
  assert.equal(body.runs.success, 1);
  assert.equal(body.runs.partial, 1);
  assert.equal(body.runs.failed, 1);
  assert.equal(body.runs.completionRate, 2 / 3);
  assert.equal(body.runs.fullSuccessRate, 1 / 3);
  assert.equal(body.games.checked, 200);
  assert.equal(body.games.updated, 150);
  assert.equal(body.games.errors, 5);
  assert.equal(body.collectionDurationSeconds.avg, 120);
  assert.equal(body.collectionDurationSeconds.p50, 120);
  assert.equal(body.collectionDurationSeconds.p95, 180);
  assert.equal(body.collectionDurationSeconds.max, 180);
  assert.equal(body.rankingRefreshDurationSeconds.avg, 45);
  assert.equal(body.rankingRefreshDurationSeconds.p50, 30);
  assert.equal(body.rankingRefreshDurationSeconds.p95, 60);
  assert.equal(body.rankingRefreshDurationSeconds.max, 60);
  assert.equal(body.schedule.largestObservedGapSeconds, 6600);
  assert.equal(body.latest.status, "success");
  assert.equal(body.latest.startedAt, recent);
  assert.equal(body.latest.rankingRefreshStatus, "success");
  assert.equal(body.latest.rankingRefreshDurationSeconds, 30);
  assert.equal(result.headers.get("cache-control"), "no-store");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /DataCollectionLog/);
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "500");
});


test("operational observability rejects invalid window lengths", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(
    new Request("https://api.example/api/observability?hours=0"),
    env,
    makeFetch(calls)
  );

  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});

test("operational observability omits invalid durations instead of inventing latency", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });

    if (url.includes("/rest/v1/DataCollectionLog?")) {
      return response([{
        startedAt: "2026-09-29T10:00:00.000Z",
        finishedAt: "2026-09-29T09:59:00.000Z",
        status: "success",
        gamesChecked: 10,
        gamesUpdated: 10,
        errors: 0
      }]);
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await handleApi(
    new Request("https://api.example/api/observability?hours=24"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;

  assert.equal(result.status, 200);
  assert.equal(body.collectionDurationSeconds.count, 0);
  assert.equal(body.collectionDurationSeconds.avg, null);
  assert.equal(body.collectionDurationSeconds.p95, null);
  assert.equal(body.latest.durationSeconds, null);
});

test("ranking endpoint returns only compact game metadata needed by ranking cards", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    const parsed = new URL(url);

    if (parsed.pathname === "/rest/v1/Ranking") {
      return response([{
        id: "10",
        gameId: "1",
        period: "weekly",
        rank: 1,
        score: 123.5,
        calculatedAt: "2026-09-27T01:20:00.000Z"
      }]);
    }

    if (parsed.pathname === "/rest/v1/Game") {
      const select = parsed.searchParams.get("select");
      if (select === "id,universeId,placeId,name,creatorName,iconUrl,isActive") {
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
        creatorId: "3001",
        iconUrl: "https://cdn.example/test.png",
        description: "A very long description that ranking cards do not need.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-09-27T00:00:00.000Z",
        isActive: true
      }]);
    }

    if (parsed.pathname === "/rest/v1/DataCollectionLog") {
      return response([{ startedAt: new Date(Date.now() - 600_000).toISOString() }]);
    }

    throw new Error("Unhandled URL: " + url);
  };

  const result = await handleApi(
    new Request("https://api.example/api/rankings?period=week"),
    env,
    fetchImpl
  );
  const body = await result.json() as Record<string, any>;
  const game = body.data[0].game;

  assert.equal(result.status, 200);
  assert.equal(game.name, "Test Game");
  assert.equal(game.creatorName, "Creator");
  assert.equal(game.iconUrl, "https://cdn.example/test.png");
  assert.equal(game.placeId, "2001");
  assert.equal(game.description, undefined);
  assert.equal(game.createdAt, undefined);
  assert.equal(game.updatedAt, undefined);

  const gameCall = calls.find(call => call.url.includes("/rest/v1/Game?"));
  assert.ok(gameCall);
  assert.equal(
    new URL(gameCall.url).searchParams.get("select"),
    "id,universeId,placeId,name,creatorName,iconUrl,isActive"
  );
});
