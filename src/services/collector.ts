import { prisma } from "./db";
import { discoverUniverseIds, getUniverseInfo, getUniverseThumbnails } from "./roblox";
import { refreshRankings } from "./ranking";
import { parseCollectorIntervalMinutes } from "../utils/collector";
import { parsePlayerCount, parseRobloxDate, parseUniverseId } from "../utils/roblox";

let collectionInProgress = false;

function parseBigIntOrNull(value: unknown): bigint | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

export async function collectOnce(): Promise<void> {
  if (collectionInProgress) {
    console.warn("Collector already running; skipping this cycle");
    return;
  }

  collectionInProgress = true;
  const startedAt = new Date();
  let gamesChecked = 0;
  let gamesUpdated = 0;
  let errors = 0;

  try {
    const universeIds = await discoverUniverseIds();
    const infos = await getUniverseInfo(universeIds);
    const thumbnails = await getUniverseThumbnails(infos.map(info => String(info.id ?? info.universeId ?? "")).filter(id => /^\d+$/.test(id)));
    console.log(
      `[Roblox thumbnail diagnostic] collector received iconMapSize=${thumbnails.size} of ${infos.length} games`
    );
    gamesChecked = infos.length;

    for (const info of infos) {
      const universeId = String(info.id ?? info.universeId ?? "");
      if (!/^\d+$/.test(universeId)) {
        errors++;
        continue;
      }

      const playerCount = parsePlayerCount(info.playing);
      const placeId = parseBigIntOrNull(info.rootPlaceId);
      const creator = info.creator && typeof info.creator === "object"
        ? info.creator as Record<string, unknown>
        : null;

      const game = await prisma.game.upsert({
        where: { universeId: BigInt(universeId) },
        update: {
          placeId,
          name: String(info.name ?? "Unknown Game"),
          creatorName: creator ? String(creator.name ?? "") || null : null,
          creatorId: parseBigIntOrNull(creator?.id),
          description: info.description == null ? null : String(info.description),
          createdAt: parseRobloxDate(info.created),
          updatedAt: parseRobloxDate(info.updated),
          isActive: true,
          iconUrl: thumbnails.get(universeId) ?? undefined
        },
        create: {
          universeId: BigInt(universeId),
          placeId,
          name: String(info.name ?? "Unknown Game"),
          creatorName: creator ? String(creator.name ?? "") || null : null,
          creatorId: parseBigIntOrNull(creator?.id),
          description: info.description == null ? null : String(info.description),
          createdAt: parseRobloxDate(info.created),
          updatedAt: parseRobloxDate(info.updated),
          isActive: true,
          iconUrl: thumbnails.get(universeId) ?? null
        }
      });

      const safePlayerCount = playerCount;
      await prisma.gameSnapshot.create({
        data: {
          gameId: game.id,
          playerCount: safePlayerCount
        }
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
  } finally {
    collectionInProgress = false;
  }
}

export function startCollector(): void {
  const intervalMinutes = parseCollectorIntervalMinutes(process.env.COLLECTOR_INTERVAL_MINUTES);
  const intervalMs = intervalMinutes * 60 * 1000;

  void collectOnce();
  setInterval(() => void collectOnce(), intervalMs);

  console.log(`Roblox collector scheduled every ${intervalMinutes} minutes`);
}
