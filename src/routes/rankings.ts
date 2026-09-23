import { Router } from "express";
import { prisma } from "../services/db";
import { jsonSafe } from "../utils/json";

export const rankingsRouter = Router();

async function getRanking(period: string, res: any) {
  try {
    const rows = await prisma.ranking.findMany({
      where: { period },
      orderBy: { rank: "asc" },
      take: 100,
      include: { game: true }
    });

    res.json(
      jsonSafe({
        period,
        updatedAt: rows[0]?.calculatedAt ?? null,
        data: rows
      })
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
}

rankingsRouter.get("/live", async (_req, res) => getRanking("live", res));
rankingsRouter.get("/weekly", async (_req, res) => getRanking("weekly", res));
rankingsRouter.get("/monthly", async (_req, res) => getRanking("monthly", res));
rankingsRouter.get("/yearly", async (_req, res) => getRanking("yearly", res));
