import { jsonSafe } from "../src/utils/json";
import { parseCollectorIntervalMinutes } from "../src/utils/collector";
import { parseHistoryDays } from "../src/utils/query";
import { parseRankingPeriod, type RankingPeriod } from "../src/utils/ranking";

export type WorkerRankingRow = {
  id: bigint;
  gameId: bigint;
  period: string;
  rank: number;
  score: number;
  calculatedAt: Date;
  game: Record<string, unknown>;
};

export type WorkerDb = {
  health(): Promise<void>;
  listRankings(period: RankingPeriod): Promise<WorkerRankingRow[]>;
  listGames(): Promise<Record<string, unknown>[]>;
  getGame(gameId: bigint): Promise<Record<string, unknown> | null>;
  getGameHistory(gameId: bigint, since: Date): Promise<Record<string, unknown>[]>;
  getGamePeak(gameId: bigint): Promise<Record<string, unknown> | null>;
  searchGames(query: string): Promise<Record<string, unknown>[]>;
};

export type WorkerApiOptions = { collectorIntervalMinutes?: unknown };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(jsonSafe(body)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function errorResponse(status: number, error: string): Response {
  return response({ error }, status);
}

function parseGameId(value: string): bigint | null {
  try { const id = BigInt(value); return id >= 0n ? id : null; }
  catch { return null; }
}

async function getRanking(db: WorkerDb, period: RankingPeriod, interval: unknown): Promise<Response> {
  try {
    const rows = await db.listRankings(period);
    const updatedAt = rows[0]?.calculatedAt ?? null;
    const refreshIntervalSeconds = parseCollectorIntervalMinutes(interval) * 60;
    const nextRefreshAt = updatedAt ? new Date(updatedAt.getTime() + refreshIntervalSeconds * 1000) : null;
    return response({ period, updatedAt, refreshIntervalSeconds, nextRefreshAt, data: rows });
  } catch (error) {
    console.error(error);
    return errorResponse(500, "Database unavailable");
  }
}

export function createApiHandler(db: WorkerDb, options: WorkerApiOptions = {}): (request: Request) => Promise<Response> {
  const interval = options.collectorIntervalMinutes ?? 10;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,OPTIONS", "access-control-allow-headers": "content-type" } });
    if (request.method !== "GET") return errorResponse(405, "Method not allowed");

    if (path === "/api/health") {
      try { await db.health(); return response({ ok: true, service: "bobaks-ranking-api", database: "connected", timestamp: new Date().toISOString() }); }
      catch { return response({ ok: false, service: "bobaks-ranking-api", database: "unavailable", timestamp: new Date().toISOString() }, 503); }
    }

    if (path === "/api/rankings") {
      try {
        const values = url.searchParams.getAll("period");
        const period = parseRankingPeriod(values.length > 1 ? values : values[0] ?? undefined);
        return getRanking(db, period, interval);
      } catch { return errorResponse(400, "Invalid period. Use live, week, month, or year."); }
    }

    if (path === "/api/games") {
      try { return response({ data: await db.listGames() }); }
      catch (error) { console.error(error); return errorResponse(500, "Database unavailable"); }
    }

    const match = path.match(/^\/api\/games\/([^/]+)(?:\/(history|peak))?$/);
    if (match) {
      const gameId = parseGameId(match[1]);
      if (gameId === null) return errorResponse(400, "Invalid game id");
      if (match[2] === "peak") {
        try { const peak = await db.getGamePeak(gameId); return peak ? response({ data: peak }) : errorResponse(404, "Peak not found"); }
        catch (error) { console.error(error); return errorResponse(500, "Database unavailable"); }
      }
      if (match[2] === "history") {
        let days: number;
        try { const values = url.searchParams.getAll("days"); days = parseHistoryDays(values.length > 1 ? values : values[0] ?? undefined); }
        catch { return errorResponse(400, "Invalid days parameter. Use an integer from 1 to 365."); }
        try { const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000); return response({ gameId, days, data: await db.getGameHistory(gameId, since) }); }
        catch (error) { console.error(error); return errorResponse(500, "Database unavailable"); }
      }
      try { const game = await db.getGame(gameId); return game ? response({ data: game }) : errorResponse(404, "Game not found"); }
      catch (error) { console.error(error); return errorResponse(500, "Database unavailable"); }
    }

    if (path === "/api/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return errorResponse(400, "Missing q parameter");
      if (q.length > 100) return errorResponse(400, "Invalid q parameter. Maximum length is 100 characters.");
      try { return response({ query: q, data: await db.searchGames(q) }); }
      catch (error) { console.error(error); return errorResponse(500, "Database unavailable"); }
    }

    return errorResponse(404, "Not found");
  };
}