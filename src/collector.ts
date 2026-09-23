import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type RobloxGame = {
  id: number;
  rootPlaceId: number;
  name: string;
  description?: string;
  creator?: { id: number; name: string };
  playing: number;
  created?: string;
  updated?: string;
};

const SEED_UNIVERSE_IDS = [
  994732206,
  2753915549,
  4924922222,
  383310974,
  920587237,
  537413528,
  1962086868,
  723262127,
  2788229376,
  142823291,
  606849621,
  13127800756
];

async function fetchGames(ids: number[]): Promise<RobloxGame[]> {
  const url = new URL("https://games.roblox.com/v1/games");
  url.searchParams.set("universeIds", ids.join(","));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Roblox games API returned ${response.status}`);
  const body = await response.json() as { data?: RobloxGame[]; errors?: unknown[] };
  if (!Array.isArray(body.data)) throw new Error("Roblox games API returned no data");
  return body.data.filter(game => Number.isFinite(game.id) && game.id > 0 && typeof game.playing === "number");
}

async function updateRankings() {
  const latest = await prisma.gameSnapshot.findMany({
    orderBy: { timestamp: "desc" },
    distinct: ["gameId"],
    include: { game: true }
  });

  await prisma.ranking.deleteMany({ where: { period: "live" } });

  await prisma.ranking.createMany({
    data: latest
      .sort((a, b) => b.playerCount - a.playerCount)
      .slice(0, 100)
      .map((snapshot, index) => ({
        gameId: snapshot.gameId,
        period: "live",
        rank: index + 1,
        score: snapshot.playerCount
      }))
  });
}

async function main() {
  const startedAt = new Date();
  let gamesUpdated = 0;
  let errors = 0;

  const log = await prisma.dataCollectionLog.create({
    data: { startedAt, status: "running" }
  });

  try {
    const games = await fetchGames(SEED_UNIVERSE_IDS);

    for (const game of games) {
      try {
        const dbGame = await prisma.game.upsert({
          where: { universeId: BigInt(game.id) },
          create: {
            universeId: BigInt(game.id),
            placeId: BigInt(game.rootPlaceId),
            name: game.name,
            creatorName: game.creator?.name,
            creatorId: game.creator?.id ? BigInt(game.creator.id) : undefined,
            description: game.description,
            createdAt: game.created ? new Date(game.created) : undefined,
            updatedAt: game.updated ? new Date(game.updated) : undefined,
            isActive: true
          },
          update: {
            placeId: BigInt(game.rootPlaceId),
            name: game.name,
            creatorName: game.creator?.name,
            creatorId: game.creator?.id ? BigInt(game.creator.id) : undefined,
            description: game.description,
            updatedAt: game.updated ? new Date(game.updated) : undefined,
            isActive: true
          }
        });

        await prisma.gameSnapshot.create({
          data: {
            gameId: dbGame.id,
            playerCount: Math.max(0, Math.round(game.playing))
          }
        });

        gamesUpdated++;
      } catch (error) {
        console.error("Game update failed:", game.id, error);
        errors++;
      }
    }

    await updateRankings();

    await prisma.dataCollectionLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        gamesChecked: games.length,
        gamesUpdated,
        errors,
        status: errors > 0 ? "completed_with_errors" : "success"
      }
    });

    console.log(`Collected ${gamesUpdated}/${games.length} Roblox games`);
  } catch (error) {
    console.error(error);
    await prisma.dataCollectionLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        gamesChecked: 0,
        gamesUpdated,
        errors: errors + 1,
        status: "failed"
      }
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
