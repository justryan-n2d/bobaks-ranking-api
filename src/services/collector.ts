import { prisma } from "./db";
import { discoverUniverseIds, getUniverseInfo } from "./roblox";
import { refreshRankings } from "./ranking";

export async function collectOnce(): Promise<void> {
  const startedAt = new Date();
  let gamesChecked = 0;
  let gamesUpdated = 0;
  let errors = 0;

  try {
    const universeIds = await discoverUniverseIds();
    const infos = await getUniverseInfo(universeIds);
    gamesChecked = infos.length;

    for (const info of infos) {
      const universeId = String(info.id ?? info.universeId ?? "");
      if (!/^\d+$/.test(universeId)) {
        errors++;
        continue;
      }

      const playerCount = Number(info.playing ?? 0);
      const placeId = info.rootPlaceId == null ? null : BigInt(String(info.rootPlaceId));
      const creator = info.creator && typeof info.creator === "object"
        ? info.creator as Record<string, unknown>
        : null;

      const game = await prisma.game.upsert({
        where: { universeId: BigInt(universeId) },
        update: {
          placeId,
          name: String(info.name ?? "Unknown Game"),
          creatorName: creator ? String(creator.name ?? "") || null : null,
          creatorId: creator?.id == null ? null : BigInt(String(creator.id)),
          description: info.description == null ? null : String(info.description),
          createdAt: info.created == null ? null : new Date(String(info.created)),
          updatedAt: info.updated == null ? null : new Date(String(info.updated)),
          isActive: true
        },
        create: {
          universeId: BigInt(universeId),
          placeId,
          name: String(info.name ?? "Unknown Game"),
          creatorName: creator ? String(creator.name ?? "") || null : null,
          creatorId: creator?.id == null ? null : BigInt(String(creator.id)),
          description: info.description == null ? null : String(info.description),
          createdAt: info.created == null ? null : new Date(String(info.created)),
          updatedAt: info.updated == null ? null : new Date(String(info.updated)),
          isActive: true
        }
      });

      await prisma.gameSnapshot.create({
        data: { gameId: game.id, playerCount: Number.isFinite(playerCount) ? Math.max(0, Math.round(playerCount)) : 0 }
      });

      gamesUpdated++;
    }

    await refreshRankings();

    await prisma.dataCollectionLog.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        gamesChecked,
        gamesUpdated,
        errors,
        status: errors ? "partial" : "success"
      }
    });

    console.log(`Collector complete: checked=${gamesChecked}, updated=${gamesUpdated}, errors=${errors}`);
  } catch (error) {
    errors++;
    console.error("Collector failed:", error);

    await prisma.dataCollectionLog.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        gamesChecked,
        gamesUpdated,
        errors,
        status: "failed"
      }
    });
  }
}

export function startCollector(): void {
  const intervalMinutes = Math.max(Number(process.env.COLLECTOR_INTERVAL_MINUTES || 10), 5);
  const intervalMs = intervalMinutes * 60 * 1000;

  void collectOnce();
  setInterval(() => void collectOnce(), intervalMs);

  console.log(`Roblox collector scheduled every ${intervalMinutes} minutes`);
}
