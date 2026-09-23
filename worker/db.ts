import { Client } from "pg";
import type { RankingPeriod } from "../src/utils/ranking";
import type { WorkerDb, WorkerRankingRow } from "./api";

export type HyperdriveBinding = { connectionString: string };
export type WorkerEnv = { HYPERDRIVE: HyperdriveBinding; COLLECTOR_INTERVAL_MINUTES?: string };

function periodToDbValue(period: RankingPeriod): string {
  return period === "live" ? "live" : period === "week" ? "weekly" : period === "month" ? "monthly" : "yearly";
}

function mapGame(row: Record<string, unknown>): Record<string, unknown> {
  return { id: row.id, universeId: row.universeId, placeId: row.placeId, name: row.name, creatorName: row.creatorName, creatorId: row.creatorId, iconUrl: row.iconUrl, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt, isActive: row.isActive };
}

export function createPgDatabase(client: Client): WorkerDb {
  return {
    async health() { await client.query("SELECT 1"); },
    async listRankings(period) {
      const result = await client.query(
        "SELECT r.id, r.\"gameId\" AS \"gameId\", r.period, r.rank, r.score, r.\"calculatedAt\" AS \"calculatedAt\", " +
        "g.id AS g_id, g.\"universeId\" AS g_universeId, g.\"placeId\" AS g_placeId, g.name AS g_name, " +
        "g.\"creatorName\" AS g_creatorName, g.\"creatorId\" AS g_creatorId, g.\"iconUrl\" AS g_iconUrl, " +
        "g.description AS g_description, g.\"createdAt\" AS g_createdAt, g.\"updatedAt\" AS g_updatedAt, g.\"isActive\" AS g_isActive " +
        "FROM public.\"Ranking\" r INNER JOIN public.\"Game\" g ON g.id = r.\"gameId\" " +
        "WHERE r.period = $1 ORDER BY r.rank ASC LIMIT 100",
        [periodToDbValue(period)]
      );
      return result.rows.map((row) => ({
        id: row.id, gameId: row.gameId, period: row.period, rank: row.rank, score: row.score, calculatedAt: row.calculatedAt,
        game: mapGame({ id: row.g_id, universeId: row.g_universeId, placeId: row.g_placeId, name: row.g_name, creatorName: row.g_creatorName, creatorId: row.g_creatorId, iconUrl: row.g_iconUrl, description: row.g_description, createdAt: row.g_createdAt, updatedAt: row.g_updatedAt, isActive: row.g_isActive })
      })) as WorkerRankingRow[];
    },
    async listGames() {
      const result = await client.query("SELECT id, \"universeId\" AS \"universeId\", \"placeId\" AS \"placeId\", name, \"creatorName\" AS \"creatorName\", \"creatorId\" AS \"creatorId\", \"iconUrl\" AS \"iconUrl\", description, \"createdAt\" AS \"createdAt\", \"updatedAt\" AS \"updatedAt\", \"isActive\" AS \"isActive\" FROM public.\"Game\" WHERE \"isActive\" = true ORDER BY name ASC LIMIT 100");
      return result.rows.map(mapGame);
    },
    async getGame(gameId) {
      const result = await client.query("SELECT id, \"universeId\" AS \"universeId\", \"placeId\" AS \"placeId\", name, \"creatorName\" AS \"creatorName\", \"creatorId\" AS \"creatorId\", \"iconUrl\" AS \"iconUrl\", description, \"createdAt\" AS \"createdAt\", \"updatedAt\" AS \"updatedAt\", \"isActive\" AS \"isActive\" FROM public.\"Game\" WHERE id = $1 AND \"isActive\" = true LIMIT 1", [gameId.toString()]);
      return result.rows[0] ? mapGame(result.rows[0]) : null;
    },
    async getGameHistory(gameId, since) {
      const result = await client.query("SELECT id, \"gameId\" AS \"gameId\", \"playerCount\" AS \"playerCount\", timestamp FROM public.\"GameSnapshot\" WHERE \"gameId\" = $1 AND timestamp >= $2 ORDER BY timestamp ASC", [gameId.toString(), since]);
      return result.rows;
    },
    async getGamePeak(gameId) {
      const result = await client.query("SELECT id, \"gameId\" AS \"gameId\", \"peakPlayers\" AS \"peakPlayers\", \"peakAt\" AS \"peakAt\" FROM public.\"GamePeak\" WHERE \"gameId\" = $1 LIMIT 1", [gameId.toString()]);
      return result.rows[0] ?? null;
    },
    async searchGames(query) {
      const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const result = await client.query("SELECT id, \"universeId\" AS \"universeId\", \"placeId\" AS \"placeId\", name, \"creatorName\" AS \"creatorName\", \"creatorId\" AS \"creatorId\", \"iconUrl\" AS \"iconUrl\", description, \"createdAt\" AS \"createdAt\", \"updatedAt\" AS \"updatedAt\", \"isActive\" AS \"isActive\" FROM public.\"Game\" WHERE \"isActive\" = true AND name ILIKE $1 ORDER BY name ASC LIMIT 50", ["%" + escaped + "%"]);
      return result.rows.map(mapGame);
    }
  };
}

export async function withPgDatabase<T>(env: WorkerEnv, callback: (db: WorkerDb) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try { return await callback(createPgDatabase(client)); }
  finally { await client.end(); }
}