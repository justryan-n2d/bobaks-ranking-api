import { prisma } from "./db";

const DEFAULT_RETENTION_DAYS = 30;

type SnapshotRow = {
  id: bigint;
  gameId: bigint;
  playerCount: number;
  timestamp: Date;
};

type DailyStatRow = {
  id: bigint;
  gameId: bigint;
  date: Date;
  averagePlayers: number;
  peakPlayers: number;
  lowestPlayers: number;
  totalSamples: number;
};

export type RetentionDb = {
  gameSnapshot: {
    findMany(args: unknown): Promise<SnapshotRow[]>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  dailyGameStat: {
    findUnique(args: unknown): Promise<DailyStatRow | null>;
    upsert(args: unknown): Promise<DailyStatRow>;
  };
  $transaction<T>(callback: (tx: RetentionDb) => Promise<T>): Promise<T>;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getRetentionCutoff(now: Date, retentionDays: number): Date {
  return startOfUtcDay(new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000));
}

export function createRetentionDb(db = prisma): RetentionDb {
  return db as unknown as RetentionDb;
}

export async function retainSnapshots(
  db: RetentionDb = createRetentionDb(),
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS
): Promise<{ aggregatedDays: number; deletedSnapshots: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("retentionDays must be a positive integer");
  }

  const cutoff = getRetentionCutoff(now, retentionDays);
  const snapshots = await db.gameSnapshot.findMany({
    where: { timestamp: { lt: cutoff } },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }]
  });

  const groups = new Map<string, {
    gameId: bigint;
    date: Date;
    snapshots: SnapshotRow[];
  }>();

  for (const snapshot of snapshots) {
    const date = startOfUtcDay(snapshot.timestamp);
    const key = `${snapshot.gameId.toString()}:${date.toISOString()}`;
    const group = groups.get(key);

    if (group) {
      group.snapshots.push(snapshot);
    } else {
      groups.set(key, {
        gameId: snapshot.gameId,
        date,
        snapshots: [snapshot]
      });
    }
  }

  let aggregatedDays = 0;
  let deletedSnapshots = 0;

  for (const group of groups.values()) {
    await db.$transaction(async (tx) => {
      const existing = await tx.dailyGameStat.findUnique({
        where: {
          gameId_date: {
            gameId: group.gameId,
            date: group.date
          }
        }
      });

      if (!existing) {
        const counts = group.snapshots.map((snapshot) => snapshot.playerCount);
        const totalSamples = counts.length;
        const sum = counts.reduce((total, count) => total + count, 0);

        await tx.dailyGameStat.upsert({
          where: {
            gameId_date: {
              gameId: group.gameId,
              date: group.date
            }
          },
          create: {
            gameId: group.gameId,
            date: group.date,
            averagePlayers: sum / totalSamples,
            peakPlayers: Math.max(...counts),
            lowestPlayers: Math.min(...counts),
            totalSamples
          },
          update: {
            averagePlayers: sum / totalSamples,
            peakPlayers: Math.max(...counts),
            lowestPlayers: Math.min(...counts),
            totalSamples
          }
        });

        aggregatedDays++;
      }

      const result = await tx.gameSnapshot.deleteMany({
        where: {
          id: {
            in: group.snapshots.map((snapshot) => snapshot.id)
          }
        }
      });

      deletedSnapshots += result.count;
    });
  }

  return { aggregatedDays, deletedSnapshots };
}
