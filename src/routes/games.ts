import { Router } from "express";
import { prisma } from "../services/db";
import { jsonSafe } from "../utils/json";

export const gamesRouter = Router();

gamesRouter.get("/", async (_req, res) => {
  try {
    const games = await prisma.game.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 100
    });

    res.json(jsonSafe({ data: games }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
});

gamesRouter.get("/:id/history", async (req, res) => {
  const gameId = Number(req.params.id);

  if (!Number.isSafeInteger(gameId) || gameId < 1) {
    return res.status(400).json({ error: "Invalid game id" });
  }

  try {
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.gameSnapshot.findMany({
      where: {
        gameId: BigInt(gameId),
        timestamp: { gte: since }
      },
      orderBy: { timestamp: "asc" }
    });

    res.json(jsonSafe({ gameId, days, data: snapshots }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
});
