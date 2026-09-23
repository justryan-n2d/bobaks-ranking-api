import { prisma } from "./db";

const PERIODS = [
  { name: "weekly", days: 7 },
  { name: "monthly", days: 30 },
  { name: "yearly", days: 365 }
] as const;

export async function refreshRankings(): Promise<void> {
  const now = new Date();

  const games = await prisma.game.findMany({
    where: { isActive: true },
    select: { id: true }
  });

  await prisma.ranking.deleteMany({
    where: { period: { in: ["live", "weekly", "monthly", "yearly"] } }
  });

  const latestSnapshots = await prisma.gameSnapshot.findMany({
    orderBy: { timestamp: "desc" },
    select: { gameId: true, playerCount: true, timestamp: true }
  });

  const latest = new Map<string, { playerCount: number; timestamp: Date }>();
  for (const row of latestSnapshots) {
    const key = row.gameId.toString();
    if (!latest.has(key)) latest.set(key, { playerCount: row.playerCount, timestamp: row.timestamp });
  }

  const liveRows = games
    .map((game) => ({ gameId: game.id, playerCount: latest.get(game.id.toString())?.playerCount ?? 0 }))
    .sort((a, b) => b.playerCount - a.playerCount)
    .slice(0, 100)
    .map((row, index) => ({
      gameId: row.gameId,
      period: "live",
      rank: index + 1,
      score: row.playerCount,
      calculatedAt: now
    }));

  if (liveRows.length) await prisma.ranking.createMany({ data: liveRows });

  for (const period of PERIODS) {
    const since = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
    const snapshots = await prisma.gameSnapshot.findMany({
      where: { timestamp: { gte: since } },
      select: { gameId: true, playerCount: true }
    });

    const sums = new Map<string, { sum: number; count: number }>();
    for (const row of snapshots) {
      const key = row.gameId.toString();
      const current = sums.get(key) ?? { sum: 0, count: 0 };
      current.sum += row.playerCount;
      current.count += 1;
      sums.set(key, current);
    }

    const rows = games
      .map((game) => {
        const stats = sums.get(game.id.toString());
        return { gameId: game.id, score: stats && stats.count ? stats.sum / stats.count : 0 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map((row, index) => ({
        gameId: row.gameId,
        period: period.name,
        rank: index + 1,
        score: row.score,
        calculatedAt: now
      }));

    if (rows.length) await prisma.ranking.createMany({ data: rows });
  }

  console.log("Ranking refresh complete");
}
