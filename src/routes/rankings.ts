import { Router } from "express";
import { prisma } from "../services/db";
import { jsonSafe } from "../utils/json";
import { parseRankingPeriod, type RankingPeriod } from "../utils/ranking";
import { parseCollectorIntervalMinutes } from "../utils/collector";

export const rankingsRouter = Router();

async function getRanking(period: RankingPeriod, res: any) {
  try {
    const rows = await prisma.ranking.findMany({
      where: {
        period:
          period === "live"
            ? "live"
            : period === "week"
              ? "weekly"
              : period === "month"
                ? "monthly"
                : "yearly"
      },
      orderBy: { rank: "asc" },
      take: 100,
      include: { game: true }
    });

    const updatedAt = rows[0]?.calculatedAt ?? null;
    const refreshIntervalSeconds =
      parseCollectorIntervalMinutes(process.env.COLLECTOR_INTERVAL_MINUTES) * 60;
    const nextRefreshAt = updatedAt
      ? new Date(updatedAt.getTime() + refreshIntervalSeconds * 1000)
      : null;

    res.json(
      jsonSafe({
        period,
        updatedAt,
        refreshIntervalSeconds,
        nextRefreshAt,
        data: rows
      })
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
}

rankingsRouter.get("/", async (req, res) => {
  try {
    const period = parseRankingPeriod(req.query.period);
    return getRanking(period, res);
  } catch {
    return res.status(400).json({
      error: "Invalid period. Use live, week, month, or year."
    });
  }
});
