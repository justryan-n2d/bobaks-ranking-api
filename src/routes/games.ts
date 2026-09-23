import { Router } from "express";
import { prisma } from "../services/db";
import { jsonSafe } from "../utils/json";
import { parseHistoryDays } from "../utils/query";

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

gamesRouter.get("/:id", async (req, res) => {
  try {
    const gameId = BigInt(req.params.id);
    const game = await prisma.game.findFirst({ where: { id: gameId, isActive: true } });
    if (!game) return res.status(404).json({ error: "Game not found" });
    res.json(jsonSafe({ data: game }));
  } catch {
    res.status(400).json({ error: "Invalid game id" });
  }
});

gamesRouter.get("/:id/history", async (req, res) => {
  let gameId: bigint;
  try {
    gameId = BigInt(req.params.id);
  } catch {
    return res.status(400).json({ error: "Invalid game id" });
  }

  let days: number;
  try {
    days = parseHistoryDays(req.query.days);
  } catch {
    return res.status(400).json({ error: "Invalid days parameter. Use an integer from 1 to 365." });
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshots = await prisma.gameSnapshot.findMany({
      where: { gameId, timestamp: { gte: since } },
      orderBy: { timestamp: "asc" }
    });
    res.json(jsonSafe({ gameId, days, data: snapshots }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
});

gamesRouter.get("/:id/peak", async (req, res) => {
  let gameId: bigint;
  try {
    gameId = BigInt(req.params.id);
  } catch {
    return res.status(400).json({ error: "Invalid game id" });
  }

  try {
    const peak = await prisma.gamePeak.findUnique({ where: { gameId } });
    if (!peak) return res.status(404).json({ error: "Peak not found" });
    res.json(jsonSafe({ data: peak }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
});
