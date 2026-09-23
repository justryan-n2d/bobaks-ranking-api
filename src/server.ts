import "dotenv/config";
import express from "express";
import cors from "cors";
import { rankingsRouter } from "./routes/rankings";
import { gamesRouter } from "./routes/games";
import { searchRouter } from "./routes/search";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bobaks-ranking-api",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/rankings", rankingsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/search", searchRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Bobaks Ranking API listening on port ${port}`);
});
