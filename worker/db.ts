import { Client } from "pg";
import type { RankingPeriod } from "../src/utils/ranking";
import type { WorkerDb, WorkerRankingRow } from "./api";
import type { ScheduledCollectorDb } from "./collector";

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

export function createPgCollectorDatabase(client: Client): ScheduledCollectorDb {
  return {
    async upsertGame(data) {
      const result = await client.query(
        'INSERT INTO public."Game" ("universeId","placeId","name","creatorName","creatorId","description","createdAt","updatedAt","isActive","iconUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT ("universeId") DO UPDATE SET "placeId"=EXCLUDED."placeId","name"=EXCLUDED."name","creatorName"=EXCLUDED."creatorName","creatorId"=EXCLUDED."creatorId","description"=EXCLUDED."description","createdAt"=EXCLUDED."createdAt","updatedAt"=EXCLUDED."updatedAt","isActive"=EXCLUDED."isActive","iconUrl"=COALESCE(EXCLUDED."iconUrl",public."Game"."iconUrl") RETURNING id',
        [data.universeId.toString(), data.placeId?.toString() ?? null, data.name, data.creatorName, data.creatorId?.toString() ?? null, data.description, data.createdAt, data.updatedAt, data.isActive, data.iconUrl ?? null]
      );
      return { id: BigInt(result.rows[0].id) };
    },
    async createSnapshot(gameId, playerCount, timestamp) {
      await client.query('INSERT INTO public."GameSnapshot" ("gameId","playerCount","timestamp") VALUES ($1,$2,$3)', [gameId.toString(), playerCount, timestamp]);
    },
    async recordPeak(gameId, playerCount, timestamp) {
      await client.query(
        'INSERT INTO public."GamePeak" ("gameId","peakPlayers","peakAt") VALUES ($1,$2,$3) ON CONFLICT ("gameId") DO UPDATE SET "peakPlayers"=EXCLUDED."peakPlayers","peakAt"=EXCLUDED."peakAt" WHERE EXCLUDED."peakPlayers" > public."GamePeak"."peakPlayers"',
        [gameId.toString(), playerCount, timestamp]
      );
    },
    async refreshRankings() {
      const now = new Date();
      await client.query("BEGIN");
      try {
        await client.query('DELETE FROM public."Ranking" WHERE period IN (\'live\',\'weekly\',\'monthly\',\'yearly\')');
        await client.query(
          'INSERT INTO public."Ranking" ("gameId",period,rank,score,"calculatedAt") SELECT "gameId",\'live\',ROW_NUMBER() OVER (ORDER BY "playerCount" DESC,"gameId" ASC), "playerCount",$1 FROM (SELECT DISTINCT ON ("gameId") "gameId","playerCount" FROM public."GameSnapshot" ORDER BY "gameId",timestamp DESC,id DESC) latest JOIN public."Game" g ON g.id=latest."gameId" WHERE g."isActive"=true ORDER BY "playerCount" DESC,"gameId" ASC LIMIT 100',
          [now]
        );
        for (const [period, days] of [["weekly",7],["monthly",30],["yearly",365]] as const) {
          const since = new Date(now.getTime() - days * 86400000);
          await client.query(
            'INSERT INTO public."Ranking" ("gameId",period,rank,score,"calculatedAt") SELECT "gameId",$1,ROW_NUMBER() OVER (ORDER BY score DESC,"gameId" ASC),score,$3 FROM (SELECT g.id AS "gameId",COALESCE(AVG(s."playerCount"),0) AS score FROM public."Game" g LEFT JOIN public."GameSnapshot" s ON s."gameId"=g.id AND s.timestamp >= $2 WHERE g."isActive"=true GROUP BY g.id) ranked ORDER BY score DESC,"gameId" ASC LIMIT 100',
            [period, since, now]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
    async recordCollectionLog(data) {
      await client.query('INSERT INTO public."DataCollectionLog" ("startedAt","finishedAt","gamesChecked","gamesUpdated","errors","status") VALUES ($1,$2,$3,$4,$5,$6)', [data.startedAt,data.finishedAt,data.gamesChecked,data.gamesUpdated,data.errors,data.status]);
    },
    async retainSnapshots(now = new Date()) {
      const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 30 * 86400000);
      const result = await client.query(
        'WITH grouped AS (SELECT "gameId", DATE_TRUNC(\'day\',timestamp AT TIME ZONE \'UTC\') AS day, AVG("playerCount") AS avg_players, MAX("playerCount") AS peak_players, MIN("playerCount") AS lowest_players, COUNT(*) AS total_samples FROM public."GameSnapshot" WHERE timestamp < $1 GROUP BY "gameId",day), upserted AS (INSERT INTO public."DailyGameStat" ("gameId",date,"averagePlayers","peakPlayers","lowestPlayers","totalSamples") SELECT "gameId",day,avg_players,peak_players,lowest_players,total_samples FROM grouped ON CONFLICT ("gameId",date) DO UPDATE SET "averagePlayers"=EXCLUDED."averagePlayers","peakPlayers"=EXCLUDED."peakPlayers","lowestPlayers"=EXCLUDED."lowestPlayers","totalSamples"=EXCLUDED."totalSamples" RETURNING "gameId",date) DELETE FROM public."GameSnapshot" s USING upserted u WHERE s."gameId"=u."gameId" AND s.timestamp < $1 AND DATE_TRUNC(\'day\',s.timestamp AT TIME ZONE \'UTC\')=u.date RETURNING s.id',
        [cutoff]
      );
      return { aggregatedDays: 0, deletedSnapshots: result.rowCount ?? 0 };
    }
  };
}

export async function withPgCollectorDatabase<T>(
  env: WorkerEnv,
  callback: (db: ScheduledCollectorDb) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try { return await callback(createPgCollectorDatabase(client)); }
  finally { await client.end(); }
}

export async function withPgDatabase<T>(env: WorkerEnv, callback: (db: WorkerDb) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try { return await callback(createPgDatabase(client)); }
  finally { await client.end(); }
}