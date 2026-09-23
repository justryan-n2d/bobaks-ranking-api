import { Router } from "express";
import { prisma } from "../services/db";
import { jsonSafe } from "../utils/json";

export const searchRouter = Router();

searchRouter.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({ error: "Missing q parameter" });
  }

  if (q.length > 100) {
    return res.status(400).json({ error: "Invalid q parameter. Maximum length is 100 characters." });
  }

  try {
    const games = await prisma.game.findMany({
      where: {
        isActive: true,
        name: { contains: q, mode: "insensitive" }
      },
      orderBy: { name: "asc" },
      take: 50
    });

    res.json(jsonSafe({ query: q, data: games }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database unavailable" });
  }
});
