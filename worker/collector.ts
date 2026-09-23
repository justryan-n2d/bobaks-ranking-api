import { discoverUniverseIds, getUniverseInfo, getUniverseThumbnails } from "../src/services/roblox";
import { refreshRankings } from "../src/services/ranking";
import { recordPeak } from "../src/services/peak";
import { parsePlayerCount, parseRobloxDate } from "../src/utils/roblox";
import { retainSnapshots } from "../src/services/retention";

export type ScheduledCollectorDb = {
  upsertGame(data: {
    universeId: bigint; placeId: bigint | null; name: string; creatorName: string | null;
    creatorId: bigint | null; description: string | null; createdAt: Date | null;
    updatedAt: Date | null; isActive: boolean; iconUrl?: string | null;
  }): Promise<{ id: bigint }>;
  createSnapshot(gameId: bigint, playerCount: number, timestamp: Date): Promise<void>;
  recordPeak(gameId: bigint, playerCount: number, timestamp: Date): Promise<void>;
  refreshRankings(): Promise<void>;
  recordCollectionLog(data: {
    startedAt: Date; finishedAt: Date; gamesChecked: number; gamesUpdated: number; errors: number; status: string;
  }): Promise<void>;
  retainSnapshots(now?: Date): Promise<{ aggregatedDays: number; deletedSnapshots: number }>;
};

function parseBigIntOrNull(value: unknown): bigint | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

export async function collectOnceWithDb(db: ScheduledCollectorDb): Promise<void> {
  const startedAt = new Date();
  let gamesChecked = 0;
  let gamesUpdated = 0;
  let errors = 0;

  try {
    const universeIds = await discoverUniverseIds();
    const infos = await getUniverseInfo(universeIds);
    const thumbnails = await getUniverseThumbnails(
      infos.map(info => String(info.id ?? info.universeId ?? "")).filter(id => /^\d+$/.test(id))
    );
    gamesChecked = infos.length;

    for (const info of infos) {
      const universeId = String(info.id ?? info.universeId ?? "");
      if (!/^\d+$/.test(universeId)) {
        errors++;
        continue;
      }

      const creator = info.creator && typeof info.creator === "object"
        ? info.creator as Record<string, unknown>
        : null;
      const game = await db.upsertGame({
        universeId: BigInt(universeId),
        placeId: parseBigIntOrNull(info.rootPlaceId),
        name: String(info.name ?? "Unknown Game"),
        creatorName: creator ? String(creator.name ?? "") || null : null,
        creatorId: parseBigIntOrNull(creator?.id),
        description: info.description == null ? null : String(info.description),
        createdAt: parseRobloxDate(info.created),
        updatedAt: parseRobloxDate(info.updated),
        isActive: true,
        iconUrl: thumbnails.get(universeId) ?? null
      });

      const playerCount = parsePlayerCount(info.playing);
      const snapshotAt = new Date();
      await db.createSnapshot(game.id, playerCount, snapshotAt);
      await db.recordPeak(game.id, playerCount, snapshotAt);
      gamesUpdated++;
    }

    await db.refreshRankings();
    await db.retainSnapshots();

    await db.recordCollectionLog({
      startedAt,
      finishedAt: new Date(),
      gamesChecked,
      gamesUpdated,
      errors,
      status: errors ? "partial" : "success"
    });

    console.log(
      `Worker collector complete: checked=${gamesChecked}, updated=${gamesUpdated}, errors=${errors}`
    );
  } catch (error) {
    errors++;
    console.error("Worker collector failed:", error);

    try {
      await db.recordCollectionLog({
        startedAt,
        finishedAt: new Date(),
        gamesChecked,
        gamesUpdated,
        errors,
        status: "failed"
      });
    } catch (logError) {
      console.error("Failed to record Worker collector failure:", logError);
    }

    throw error;
  }
}

export async function runScheduledCollection(db: ScheduledCollectorDb): Promise<void> {
  await collectOnceWithDb(db);
}
