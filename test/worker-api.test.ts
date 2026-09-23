import test from "node:test";
import assert from "node:assert/strict";
import { createApiHandler, type WorkerDb } from "../worker/api";

function makeDb(): WorkerDb {
  return {
    health: async () => {},
    listRankings: async () => [{
      id: 1n,
      gameId: 10n,
      period: "live",
      rank: 1,
      score: 123,
      calculatedAt: new Date("2026-09-24T00:00:00.000Z"),
      game: {
        id: 10n,
        universeId: 20n,
        placeId: 30n,
        name: "Test Game",
        creatorName: "Test Creator",
        creatorId: 40n,
        iconUrl: "https://example.com/icon.png",
        description: null,
        createdAt: null,
        updatedAt: null,
        isActive: true
      }
    }],
    listGames: async () => [],
    getGame: async () => ({ id: 10n, universeId: 20n, name: "Test Game", isActive: true }),
    getGameHistory: async () => [{ id: 1n, gameId: 10n, playerCount: 123, timestamp: new Date("2026-09-24T00:00:00.000Z") }],
    getGamePeak: async () => ({ id: 1n, gameId: 10n, peakPlayers: 456, peakAt: new Date("2026-09-24T00:00:00.000Z") }),
    searchGames: async () => [{ id: 10n, universeId: 20n, name: "Test Game", isActive: true }]
  };
}

test("worker API serves rankings with the existing response contract", async () => {
  const handler = createApiHandler(makeDb());
  const response = await handler(new Request("https://example.com/api/rankings?period=live"));

  assert.equal(response.status, 200);
  const body = await response.json() as {
    period: string;
    updatedAt: string | null;
    refreshIntervalSeconds: number;
    nextRefreshAt: string | null;
    data: Array<{ gameId: string; game: { name: string } }>;
  };

  assert.equal(body.period, "live");
  assert.equal(body.refreshIntervalSeconds, 600);
  assert.equal(body.data[0].gameId, "10");
  assert.equal(body.data[0].game.name, "Test Game");
});

test("worker API rejects invalid ranking periods", async () => {
  const handler = createApiHandler(makeDb());
  const response = await handler(new Request("https://example.com/api/rankings?period=weekly"));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid period. Use live, week, month, or year."
  });
});

test("worker API serves health without exposing database internals", async () => {
  const handler = createApiHandler(makeDb());
  const response = await handler(new Request("https://example.com/api/health"));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("worker API returns 404 for unknown routes", async () => {
  const handler = createApiHandler(makeDb());
  const response = await handler(new Request("https://example.com/api/unknown"));

  assert.equal(response.status, 404);
});


test("worker API serves game, peak, history, and search routes", async () => {
  const handler = createApiHandler(makeDb());

  const game = await handler(new Request("https://example.com/api/games/10"));
  assert.equal(game.status, 200);
  assert.equal((await game.json()).data.id, "10");

  const peak = await handler(new Request("https://example.com/api/games/10/peak"));
  assert.equal(peak.status, 200);
  assert.equal((await peak.json()).data.peakPlayers, 456);

  const history = await handler(new Request("https://example.com/api/games/10/history?days=30"));
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.equal(historyBody.days, 30);
  assert.equal(historyBody.data[0].playerCount, 123);

  const search = await handler(new Request("https://example.com/api/search?q=Test"));
  assert.equal(search.status, 200);
  assert.equal((await search.json()).data[0].name, "Test Game");
});

test("worker API rejects invalid game ids and history days", async () => {
  const handler = createApiHandler(makeDb());

  const invalidId = await handler(new Request("https://example.com/api/games/not-a-number"));
  assert.equal(invalidId.status, 400);

  const invalidDays = await handler(new Request("https://example.com/api/games/10/history?days=0"));
  assert.equal(invalidDays.status, 400);

  const missingSearch = await handler(new Request("https://example.com/api/search"));
  assert.equal(missingSearch.status, 400);
});
