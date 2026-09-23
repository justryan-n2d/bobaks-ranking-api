import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./services/db";
import { rankingsRouter } from "./routes/rankings";
import { gamesRouter } from "./routes/games";
import { searchRouter } from "./routes/search";
import { startCollector } from "./services/collector";
import { backfillMissingPeaks } from "./services/peak-backfill";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      service: "bobaks-ranking-api",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: "bobaks-ranking-api",
      database: "unavailable",
      timestamp: new Date().toISOString()
    });
  }
});

app.use("/api/rankings", rankingsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/search", searchRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

let collectorInterval: NodeJS.Timeout;

const server = app.listen(port, () => {
  console.log(`Bobaks Ranking API listening on port ${port}`);
  void backfillMissingPeaks()
    .then(count => {
      console.log(`Historical peak backfill complete: inserted=${count}`);
      collectorInterval = startCollector();
    })
    .catch(error => {
      console.error("Historical peak backfill failed:", error);
      collectorInterval = startCollector();
    });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; shutting down gracefully`);
  clearInterval(collectorInterval);

  server.close(async () => {
    await prisma.$disconnect();
    console.log("Shutdown complete");
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
