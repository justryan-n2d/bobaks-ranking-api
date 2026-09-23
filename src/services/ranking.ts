import { prisma } from "./db";

const PERIODS = [
  { name: "weekly", days: 7 },
  { name: "monthly", days: 30 },
  { name: "yearly", days: 365 }
] as const;

function compareGameIds(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function refreshRankings(db = prisma): Promise<void> {
  const now = new Date();

  const games = await db.game.findMany({
    where: { isActive: true },
    select: { id: true }
  });

  try {
    await db.$transaction(async (tx) => {
      await tx.ranking.deleteMany({
        where: { period: { in: ["live", "weekly", "monthly", "yearly"] } }
      });

      const latestSnapshots = await tx.$queryRaw<Array<{
        gameId: bigint;
        playerCount: number;
      }>>`
        SELECT DISTINCT ON ("gameId")
          "gameId",
          "playerCount"
        FROM "GameSnapshot"
        ORDER BY "gameId", "timestamp" DESC, "id" DESC
      `;

      const latest = new Map<string, number>();
      for (const row of latestSnapshots) {
        latest.set(row.gameId.toString(), Number(row.playerCount));
      }

      const liveRows = games
        .map((game) => ({
          gameId: game.id,
          playerCount: latest.get(game.id.toString()) ?? 0
        }))
        .sort((a, b) => b.playerCount - a.playerCount || compareGameIds(a.gameId, b.gameId))
        .slice(0, 100)
        .map((row, index) => ({
          gameId: row.gameId,
          period: "live",
          rank: index + 1,
          score: row.playerCount,
          calculatedAt: now
        }));

      if (liveRows.length) await tx.ranking.createMany({ data: liveRows });

      for (const period of PERIODS) {
        const since = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
        const snapshots = await tx.$queryRaw<Array<{
          gameId: bigint;
          score: number;
        }>>`
          SELECT
            "gameId",
            AVG("playerCount") AS "score"
          FROM "GameSnapshot"
          WHERE "timestamp" >= ${since}
          GROUP BY "gameId"
        `;

        const sums = new Map<string, number>();
        for (const row of snapshots) {
          sums.set(row.gameId.toString(), Number(row.score));
        }

        const rows = games
          .map((game) => ({
            gameId: game.id,
            score: sums.get(game.id.toString()) ?? 0
          }))
          .sort((a, b) => b.score - a.score || compareGameIds(a.gameId, b.gameId))
          .slice(0, 100)
          .map((row, index) => ({
            gameId: row.gameId,
            period: period.name,
            rank: index + 1,
            score: row.score,
            calculatedAt: now
          }));

        if (rows.length) await tx.ranking.createMany({ data: rows });
      }
    });

    console.log("Ranking refresh complete");
  } catch (error) {
    console.error("Ranking refresh failed:", error);
    throw error;
  }
}
