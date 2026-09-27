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

test("ranking endpoint supports the current period query contract", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const result = await handleApi(new Request("https://api.example/api/rankings?period=week"), env, makeFetch(calls));

  const body = await result.json() as Record<string, unknown>;
  assert.equal(result.status, 200);
  assert.equal(body.period, "week");
  assert.equal(body.refreshIntervalSeconds, 600);
  assert.equal((body.data as unknown[]).length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /period=eq\.weekly/);
  assert.equal(new URL(calls[1].url).searchParams.get("id"), "in.(1)");
});

test("legacy ranking paths remain compatible during Railway cutover", async () => {
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
