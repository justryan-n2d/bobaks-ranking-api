import { prisma } from "./db";

type PeakDb = Pick<typeof prisma, "gamePeak">;

export async function recordPeak(
  db: PeakDb,
  gameId: bigint,
  playerCount: number,
  timestamp: Date
): Promise<void> {
  const existing = await db.gamePeak.findUnique({
    where: { gameId }
  });

  if (!existing) {
    await db.gamePeak.create({
      data: {
        gameId,
        peakPlayers: playerCount,
        peakAt: timestamp
      }
    });
    return;
  }

  if (playerCount > existing.peakPlayers) {
    await db.gamePeak.update({
      where: { gameId },
      data: {
        peakPlayers: playerCount,
        peakAt: timestamp
      }
    });
  }
}
